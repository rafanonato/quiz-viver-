#!/usr/bin/env bash
# Configuração inicial do GCP para o quiz (rodar uma vez).
# Pré-requisitos: gcloud autenticado (gcloud auth login), gh autenticado (gh auth login),
# e faturamento vinculado ao projeto (gcloud billing projects link ...).
# Os comandos são idempotentes: podem ser rodados de novo sem quebrar nada.
set -euo pipefail

PROJECT_ID="rafanonato1"
REGION="us-central1"
SERVICE="quiz-viver"
REPO="rafanonato/quiz-viver-"
RUNTIME_SA="quiz-runtime"
DEPLOY_SA="github-deployer"
SECRET="quiz-admin-password"
POOL="github-pool"
PROVIDER="github-provider"

RUNTIME_EMAIL="${RUNTIME_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
DEPLOY_EMAIL="${DEPLOY_SA}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "==> Projeto e APIs"
gcloud config set project "$PROJECT_ID"
gcloud services enable \
  run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  firestore.googleapis.com secretmanager.googleapis.com iam.googleapis.com \
  iamcredentials.googleapis.com sts.googleapis.com serviceusage.googleapis.com

echo "==> Firestore (modo nativo) em ${REGION}"
gcloud firestore databases create --location="$REGION" --type=firestore-native 2>/dev/null \
  || echo "    (banco já existe)"

echo "==> Conta de serviço do Cloud Run (acesso ao Firestore e ao segredo)"
gcloud iam service-accounts create "$RUNTIME_SA" --display-name="Quiz runtime" 2>/dev/null \
  || echo "    (conta já existe)"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_EMAIL}" --role="roles/datastore.user" --quiet >/dev/null

echo "==> Senha do painel admin (Secret Manager)"
if ! gcloud secrets describe "$SECRET" >/dev/null 2>&1; then
  openssl rand -base64 24 | tr -d '\n' | gcloud secrets create "$SECRET" --data-file=-
  echo "    Senha criada. Para ver: gcloud secrets versions access latest --secret=${SECRET}"
else
  echo "    (segredo já existe)"
fi
gcloud secrets add-iam-policy-binding "$SECRET" \
  --member="serviceAccount:${RUNTIME_EMAIL}" --role="roles/secretmanager.secretAccessor" --quiet >/dev/null

echo "==> Workload Identity Federation (GitHub Actions sem chave JSON)"
gcloud iam workload-identity-pools create "$POOL" --location=global --display-name="GitHub" 2>/dev/null \
  || echo "    (pool já existe)"
gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
  --location=global --workload-identity-pool="$POOL" --display-name="GitHub provider" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository=='${REPO}'" 2>/dev/null \
  || echo "    (provedor já existe)"

echo "==> Conta de serviço usada pelo GitHub para fazer o deploy"
gcloud iam service-accounts create "$DEPLOY_SA" --display-name="GitHub deployer" 2>/dev/null \
  || echo "    (conta já existe)"
for role in roles/run.admin roles/iam.serviceAccountUser roles/cloudbuild.builds.editor \
            roles/storage.admin roles/artifactregistry.admin roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${DEPLOY_EMAIL}" --role="$role" --quiet >/dev/null
done

POOL_NAME=$(gcloud iam workload-identity-pools describe "$POOL" --location=global --format='value(name)')
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_EMAIL" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${POOL_NAME}/attribute.repository/${REPO}" --quiet >/dev/null
PROVIDER_NAME=$(gcloud iam workload-identity-pools providers describe "$PROVIDER" \
  --location=global --workload-identity-pool="$POOL" --format='value(name)')

echo "==> Variáveis no repositório GitHub (não são segredos)"
gh variable set GCP_PROJECT_ID --repo "$REPO" --body "$PROJECT_ID"
gh variable set GCP_REGION --repo "$REPO" --body "$REGION"
gh variable set GCP_WIF_PROVIDER --repo "$REPO" --body "$PROVIDER_NAME"
gh variable set GCP_DEPLOY_SA --repo "$REPO" --body "$DEPLOY_EMAIL"

echo "==> Pronto. Próximo passo: git push (o workflow de deploy roda sozinho)."
