'use strict';
// Persistência das perguntas.
// - Local (padrão): arquivo questions.json.
// - Produção (Cloud Run): Firestore, doc "quiz/questions", ativado com STORAGE=firestore.
//   O arquivo do container é efêmero, por isso o Firestore é necessário para salvar edições.

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'questions.json');
const USE_FIRESTORE = process.env.STORAGE === 'firestore';
let docRef = null;

function readSeedFile() {
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

async function loadQuestions() {
  if (!USE_FIRESTORE) return readSeedFile();

  const { Firestore } = require('@google-cloud/firestore');
  docRef = new Firestore().collection('quiz').doc('questions');
  const snap = await docRef.get();
  if (snap.exists) return snap.data().items;

  // Primeira execução: semeia o Firestore com o questions.json do projeto.
  const items = readSeedFile();
  await docRef.set({ items, updatedAt: new Date().toISOString() });
  return items;
}

async function saveQuestions(items) {
  if (USE_FIRESTORE) {
    await docRef.set({ items, updatedAt: new Date().toISOString() });
    return;
  }
  fs.writeFileSync(FILE, JSON.stringify(items, null, 2) + '\n');
}

module.exports = { loadQuestions, saveQuestions, USE_FIRESTORE };
