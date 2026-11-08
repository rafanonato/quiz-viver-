'use strict';
// Persistência.
// - Local (padrão): perguntas em questions.json. Estado do jogo não é salvo.
// - Produção (Cloud Run, STORAGE=firestore):
//   - quiz/questions: perguntas editáveis pelo painel admin.
//   - quiz/<GAME_DOC> (padrão "activeGame"): estado do jogo em andamento, salvo a cada mudança.
//     Se a instância cair, a nova lê esse documento e retoma o jogo.
//     O campo "owner" identifica a instância que pode escrever. Uma instância antiga que
//     continue ativa durante uma troca de revisão é "cercada" (fenced) e para de escrever.

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'questions.json');
const USE_FIRESTORE = process.env.STORAGE === 'firestore';
const GAME_DOC = process.env.GAME_DOC || 'activeGame';

let db = null;
let questionsRef = null;
let gameRef = null;

class FencedError extends Error {
  constructor() {
    super('Instância substituída por outra (fenced)');
    this.name = 'FencedError';
  }
}

function readSeedFile() {
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

function ensureDb() {
  if (!db) {
    const { Firestore } = require('@google-cloud/firestore');
    db = new Firestore();
    questionsRef = db.collection('quiz').doc('questions');
    gameRef = db.collection('quiz').doc(GAME_DOC);
  }
  return db;
}

async function loadQuestions() {
  if (!USE_FIRESTORE) return readSeedFile();

  ensureDb();
  const snap = await questionsRef.get();
  if (snap.exists) return snap.data().items;

  // Primeira execução: semeia o Firestore com o questions.json do projeto.
  const items = readSeedFile();
  await questionsRef.set({ items, updatedAt: new Date().toISOString() });
  return items;
}

async function saveQuestions(items) {
  if (USE_FIRESTORE) {
    ensureDb();
    await questionsRef.set({ items, updatedAt: new Date().toISOString() });
    return;
  }
  fs.writeFileSync(FILE, JSON.stringify(items, null, 2) + '\n');
}

// Ao iniciar, a instância assume o jogo e recebe o último estado salvo (ou null).
async function claimGame(owner) {
  if (!USE_FIRESTORE) return null;
  ensureDb();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(gameRef);
    const previous = snap.exists ? snap.data() : null;
    tx.set(gameRef, { owner, claimedAt: new Date().toISOString() }, { merge: true });
    return previous && previous.pin ? previous : null;
  });
}

// Grava o estado completo. Falha com FencedError se outra instância já assumiu o jogo.
async function saveGame(snapshot, owner) {
  if (!USE_FIRESTORE) return;
  ensureDb();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(gameRef);
    if (snap.exists && snap.data().owner !== owner) throw new FencedError();
    tx.set(gameRef, { ...snapshot, owner, updatedAt: new Date().toISOString() });
  });
}

// Dono atual do jogo (usado pela instância para saber se foi substituída).
async function currentOwner() {
  if (!USE_FIRESTORE) return null;
  ensureDb();
  const snap = await gameRef.get();
  return snap.exists ? snap.data().owner || null : null;
}

module.exports = { loadQuestions, saveQuestions, claimGame, saveGame, currentOwner, FencedError, USE_FIRESTORE };
