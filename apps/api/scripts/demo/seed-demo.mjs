// ULTM8 demo seed: one Franchise ("Apex Jiu-Jitsu") with its main academy and
// three franchisee Schools, populated with about three months of history, for
// clicking through the School Portal, the coach screens and the member app.
// See README.md beside this file for the logins and what each shows.
//
//   API=http://127.0.0.1:3540/v1 node scripts/demo/seed-demo.mjs     (from apps/api)
//
// Needs: DATABASE_URL (the database owner: bulk history is written straight
// into the database) and the API that uses that database at $API (the ladders,
// plans, waiver and timetable go through the real API, signed in as each owner
// with the seeded passcode). Making a weekly class makes its coming weeks of
// Classes. REDIS_URL is optional: when set, the seed also runs the class
// generator job there. DEMO_PASSCODE sets every login's passcode (default
// 123456 on a local database; required, and not 123456, on any other).
//
// Safe to re-run: it first deletes its own demo tenants (the Franchise below,
// its Schools, and every account on the demo email domain or a child account
// enrolled only there), then seeds them again. Nothing else is touched.
// Refuses a non-local database unless ULTM8_ALLOW_DEV_SEED_HOST names it, and
// always refuses NODE_ENV=production (prisma/dev-seed-guard.js).
import { createRequire } from 'module';
import { randomUUID, randomBytes, createHash } from 'crypto';

const require = createRequire(import.meta.url);
require('../../prisma/dev-seed-guard').assertDevDatabase('seed-demo.mjs');
if (String(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live_')) throw new Error('seed-demo.mjs: a live Stripe key is set; refusing.');

const { PrismaClient, Prisma } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { DateTime } = require('luxon');

const API = (process.env.API || 'http://127.0.0.1:3540/v1').replace(/\/+$/, '');
// A database that isn't on this machine (staging) must get its own passcode:
// the default one is in this repo for anyone to read.
const LOCAL_DB = ['localhost', '127.0.0.1', '::1', '[::1]', 'db'].includes(new URL(process.env.DATABASE_URL).hostname);
if (!LOCAL_DB && !process.env.DEMO_PASSCODE) throw new Error('seed-demo.mjs: DEMO_PASSCODE is not set. A non-local database needs its own 6-digit passcode for the demo logins.');
if (!LOCAL_DB && process.env.DEMO_PASSCODE === '123456') throw new Error('seed-demo.mjs: DEMO_PASSCODE is 123456, the passcode written in this repo. Choose another 6-digit passcode.');
const PASSCODE = process.env.DEMO_PASSCODE || '123456';
if (!/^\d{6}$/.test(PASSCODE)) throw new Error('DEMO_PASSCODE must be exactly 6 digits');
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

export const DOMAIN = 'apex-demo.example'; // RFC 2606 reserved: never a real inbox
const MINOR_DOMAIN = 'guardian-managed.ultm8.internal'; // the API's own child-account domain
const FRANCHISE_ID = 'de300000-0000-4000-8000-000000000001';
const DAY = 86_400_000;
const NOW = new Date();
const HISTORY_WEEKS = 13;
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s]`, ...a);

// ---------------------------------------------------------------- randomness
let seed = 20261110;
const rand = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rand() * a.length)];
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const chance = (p) => rand() < p;
const weighted = (pairs) => { let r = rand() * pairs.reduce((s, [, w]) => s + w, 0); for (const [v, w] of pairs) { if ((r -= w) <= 0) return v; } return pairs[pairs.length - 1][0]; };
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const hex = (n = 12) => randomBytes(n).toString('hex');
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const chunked = async (rows, fn, size = 2000) => { for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size)); };
const daysAgo = (n) => new Date(NOW.getTime() - n * DAY);

// ---------------------------------------------------------------- names
const NAMES = {
  GB: {
    m: ['Oliver', 'Harry', 'George', 'Jack', 'Charlie', 'Thomas', 'James', 'William', 'Alfie', 'Joshua', 'Daniel', 'Samuel', 'Leo', 'Ethan', 'Mohammed', 'Ryan', 'Callum', 'Lewis', 'Ben', 'Max', 'Adam', 'Kieran', 'Jamal', 'Nathan', 'Luke', 'Aaron', 'Theo', 'Arjun', 'Kwame', 'Reuben'],
    f: ['Olivia', 'Amelia', 'Isla', 'Ava', 'Mia', 'Emily', 'Grace', 'Sophie', 'Chloe', 'Lily', 'Ella', 'Jessica', 'Hannah', 'Lucy', 'Freya', 'Zara', 'Aisha', 'Priya', 'Holly', 'Megan', 'Niamh', 'Poppy', 'Ruby', 'Evie', 'Imogen', 'Leah', 'Maya', 'Abigail'],
    s: ['Smith', 'Jones', 'Taylor', 'Brown', 'Williams', 'Wilson', 'Johnson', 'Davies', 'Patel', 'Wright', 'Robinson', 'Walker', 'Thompson', 'Evans', 'Khan', 'Hughes', 'Green', 'Hall', 'Lewis', 'Clarke', 'Jackson', 'Wood', 'Harris', 'Martin', 'Cooper', 'King', 'Baker', 'Turner', 'Ali', 'Okafor', 'Mensah', 'Shah', 'Murphy', 'Campbell', 'Morgan', 'Bennett', 'Ward', 'Price', 'Fletcher', 'Begum', 'Nowak', 'Kowalski', 'Costa', 'Ahmed', 'Gray'],
  },
  IE: {
    m: ['Seán', 'Conor', 'Jack', 'Darragh', 'Cian', 'Oisín', 'Liam', 'Fionn', 'Ciarán', 'Eoin', 'Patrick', 'Niall', 'Rory', 'Killian', 'Tadhg', 'Aidan', 'Shane', 'Dylan', 'Mark', 'Luke', 'Tomás', 'Ronan'],
    f: ['Aoife', 'Ciara', 'Niamh', 'Saoirse', 'Róisín', 'Sinéad', 'Emma', 'Grace', 'Caoimhe', 'Orla', 'Siobhán', 'Éabha', 'Clodagh', 'Aisling', 'Sarah', 'Kate', 'Laura', 'Ailbhe', 'Méabh'],
    s: ['Murphy', 'Kelly', "O'Sullivan", 'Walsh', 'Smith', "O'Brien", 'Byrne', 'Ryan', "O'Connor", "O'Neill", 'Reilly', 'Doyle', 'McCarthy', 'Gallagher', 'Doherty', 'Kennedy', 'Lynch', 'Murray', 'Quinn', 'Moore', 'McLoughlin', 'Carroll', 'Connolly', 'Daly', 'Brennan', 'Fitzgerald', 'Nolan', 'Kavanagh'],
  },
  BR: {
    m: ['Lucas', 'Gabriel', 'Mateus', 'Pedro', 'Rafael', 'Gustavo', 'Felipe', 'João', 'Bruno', 'Thiago', 'Diego', 'Rodrigo', 'Leonardo', 'Vinícius', 'Caio', 'Enzo', 'Arthur', 'Heitor', 'Davi', 'Miguel', 'André', 'Marcelo', 'Renan', 'Igor'],
    f: ['Ana', 'Beatriz', 'Mariana', 'Juliana', 'Camila', 'Larissa', 'Fernanda', 'Gabriela', 'Letícia', 'Bruna', 'Isabela', 'Amanda', 'Carolina', 'Laura', 'Valentina', 'Helena', 'Alice', 'Manuela', 'Sofia', 'Luiza', 'Rafaela'],
    s: ['Silva', 'Santos', 'Oliveira', 'Souza', 'Rodrigues', 'Ferreira', 'Alves', 'Pereira', 'Lima', 'Gomes', 'Costa', 'Ribeiro', 'Martins', 'Carvalho', 'Almeida', 'Lopes', 'Soares', 'Fernandes', 'Vieira', 'Barbosa', 'Rocha', 'Dias', 'Nascimento', 'Andrade', 'Moreira', 'Nunes', 'Mendes', 'Cardoso', 'Teixeira', 'Machado'],
  },
};
const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z]/g, '').toLowerCase();

// ---------------------------------------------------------------- the cast
const PLAN_SETS = {
  GBP: [
    { key: 'unlimited', type: 'SUBSCRIPTION', title: 'Unlimited Monthly', price: 9900, disc: ['adult'], includesLessons: true },
    { key: 'kids', type: 'SUBSCRIPTION', title: 'Kids Monthly', price: 6500, disc: ['kids'], includesLessons: true },
    { key: 'pack10', type: 'CLASS_PACK', title: '10-Class Pack', price: 13000, classesIncluded: 10, expiryDurationDays: 90, disc: ['adult', 'kids'] },
    { key: 'dropin', type: 'CLASS_PACK', title: 'Drop-in Class', price: 1800, classesIncluded: 1, expiryDurationDays: 30, disc: ['adult', 'kids'] },
    { key: 'trial', type: 'TRIAL_MEMBERSHIP', title: 'Free Trial Week', price: 0, expiryDurationDays: 7, disc: ['adult', 'kids'] },
    { key: 'friend', type: 'FRIEND_PASS', title: 'Bring a Friend', price: 0, classesIncluded: 1, expiryDurationDays: 30, disc: ['adult'] },
  ],
  EUR: [
    { key: 'unlimited', type: 'SUBSCRIPTION', title: 'Unlimited Monthly', price: 9500, disc: ['adult'], includesLessons: true },
    { key: 'kids', type: 'SUBSCRIPTION', title: 'Kids Monthly', price: 6000, disc: ['kids'], includesLessons: true },
    { key: 'pack10', type: 'CLASS_PACK', title: '10-Class Pack', price: 12000, classesIncluded: 10, expiryDurationDays: 90, disc: ['adult', 'kids'] },
    { key: 'dropin', type: 'CLASS_PACK', title: 'Drop-in Class', price: 1500, classesIncluded: 1, expiryDurationDays: 30, disc: ['adult', 'kids'] },
    { key: 'trial', type: 'TRIAL_MEMBERSHIP', title: 'Free Trial Week', price: 0, expiryDurationDays: 7, disc: ['adult', 'kids'] },
    { key: 'friend', type: 'FRIEND_PASS', title: 'Bring a Friend', price: 0, classesIncluded: 1, expiryDurationDays: 30, disc: ['adult'] },
  ],
  // The Brazilian School takes no cards (as built: Pix or cash, confirmed by the
  // School). Its monthly fee is a 30-day pass bought each month at the desk or by Pix.
  BRL: [
    { key: 'unlimited', type: 'WEEKLY_PASS', title: 'Mensalidade Adulto (30 dias)', price: 34000, expiryDurationDays: 30, disc: ['adult'], includesLessons: true },
    { key: 'kids', type: 'WEEKLY_PASS', title: 'Mensalidade Kids (30 dias)', price: 24000, expiryDurationDays: 30, disc: ['kids'], includesLessons: true },
    { key: 'pack10', type: 'CLASS_PACK', title: 'Pacote 10 aulas', price: 40000, classesIncluded: 10, expiryDurationDays: 90, disc: ['adult', 'kids'] },
    { key: 'dropin', type: 'CLASS_PACK', title: 'Aula avulsa', price: 6000, classesIncluded: 1, expiryDurationDays: 30, disc: ['adult', 'kids'] },
    { key: 'trial', type: 'TRIAL_MEMBERSHIP', title: 'Semana experimental', price: 0, expiryDurationDays: 7, disc: ['adult', 'kids'] },
    { key: 'friend', type: 'FRIEND_PASS', title: 'Traga um amigo', price: 0, classesIncluded: 1, expiryDurationDays: 30, disc: ['adult'] },
  ],
};

const EN_SCHEDULE_MAIN = [
  { title: 'Morning Fundamentals', type: 'Adult Fundamentals', disc: 'adult', days: [1, 3, 5], start: '06:30', end: '07:30', cap: 25 },
  { title: 'Lunchtime Fundamentals', type: 'Adult Fundamentals', disc: 'adult', days: [1, 2, 3, 4, 5], start: '12:15', end: '13:15', cap: 25 },
  { title: 'Kids BJJ (5–8)', type: 'Kids Fundamentals', disc: 'kids', days: [1, 3], start: '16:15', end: '17:00', cap: 20, kids: true },
  { title: 'Kids BJJ (9–13)', type: 'Kids Fundamentals', disc: 'kids', days: [2, 4], start: '16:30', end: '17:30', cap: 20, kids: true },
  { title: 'Kids Sparring', type: 'Kids Sparring', disc: 'kids', days: [5], start: '16:30', end: '17:30', cap: 20, kids: true },
  { title: 'Fundamentals', type: 'Adult Fundamentals', disc: 'adult', days: [1, 2, 3, 4], start: '18:00', end: '19:00', cap: 30 },
  { title: 'Advanced & Sparring', type: 'Adult Sparring', disc: 'adult', days: [1, 2, 3, 4], start: '19:15', end: '20:45', cap: 30 },
  { title: 'Competition Team', type: 'Competition Team', disc: 'adult', days: [3, 5], start: '19:00', end: '20:30', cap: 20 },
  { title: 'Saturday Kids', type: 'Kids Fundamentals', disc: 'kids', days: [6], start: '09:30', end: '10:30', cap: 25, kids: true },
  { title: 'Saturday Open Mat', type: 'Adult Sparring', disc: 'adult', days: [6], start: '11:00', end: '12:30', cap: 40 },
  { title: "Women's BJJ", type: 'Adult Fundamentals', disc: 'adult', days: [7], start: '10:00', end: '11:00', cap: 20, audience: 'WOMEN' },
];
const EN_SCHEDULE_SMALL = [
  { title: 'Morning Fundamentals', type: 'Adult Fundamentals', disc: 'adult', days: [2, 4], start: '07:00', end: '08:00', cap: 25 },
  { title: 'Kids BJJ', type: 'Kids Fundamentals', disc: 'kids', days: [1, 3, 5], start: '17:00', end: '17:45', cap: 20, kids: true },
  { title: 'Fundamentals', type: 'Adult Fundamentals', disc: 'adult', days: [1, 2, 3, 4], start: '18:30', end: '19:30', cap: 30 },
  { title: 'Advanced & Sparring', type: 'Adult Sparring', disc: 'adult', days: [1, 3], start: '19:30', end: '21:00', cap: 30 },
  { title: 'Competition Team', type: 'Competition Team', disc: 'adult', days: [5], start: '19:00', end: '20:30', cap: 20 },
  { title: 'Saturday Kids', type: 'Kids Fundamentals', disc: 'kids', days: [6], start: '09:30', end: '10:30', cap: 25, kids: true },
  { title: 'Saturday Open Mat', type: 'Adult Sparring', disc: 'adult', days: [6], start: '10:30', end: '12:00', cap: 40 },
];
const PT_SCHEDULE = [
  { title: 'Treino da manhã', type: 'Adult Fundamentals', disc: 'adult', days: [2, 4], start: '07:00', end: '08:00', cap: 25 },
  { title: 'Fundamentos (almoço)', type: 'Adult Fundamentals', disc: 'adult', days: [1, 3, 5], start: '12:00', end: '13:00', cap: 25 },
  { title: 'Kids', type: 'Kids Fundamentals', disc: 'kids', days: [1, 3, 5], start: '17:00', end: '17:50', cap: 25, kids: true },
  { title: 'Fundamentos', type: 'Adult Fundamentals', disc: 'adult', days: [1, 2, 3, 4], start: '19:00', end: '20:00', cap: 35 },
  { title: 'Avançado e rola', type: 'Adult Sparring', disc: 'adult', days: [1, 2, 3, 4], start: '20:00', end: '21:30', cap: 35 },
  { title: 'Equipe de competição', type: 'Competition Team', disc: 'adult', days: [5], start: '19:00', end: '20:30', cap: 20 },
  { title: 'Kids sábado', type: 'Kids Fundamentals', disc: 'kids', days: [6], start: '09:00', end: '10:00', cap: 25, kids: true },
  { title: 'Open mat de sábado', type: 'Adult Sparring', disc: 'adult', days: [6], start: '10:00', end: '12:00', cap: 40 },
];

const SCHOOLS = [
  {
    key: 'hq', id: 'de300000-0000-4000-8000-000000000011', main: true, country: 'GB', currency: 'GBP', language: 'en-GB', timezone: 'Europe/London', names: 'GB',
    name: 'Apex Jiu-Jitsu HQ', opened: '2016-03-01', students: 430,
    description: 'The original Apex academy and home of the Apex team: Brazilian Jiu-Jitsu for adults and kids, seven days a week.',
    address: { addressLine1: '48 Rivington Street', addressCity: 'London', addressPostalCode: 'EC2A 3QP', addressCountry: 'GB' }, mobileNumber: '+447700900100',
    branches: [
      { key: 'shoreditch', name: 'Shoreditch', share: 0.62, schedule: EN_SCHEDULE_MAIN, address: { addressLine1: '48 Rivington Street', addressCity: 'London', addressPostalCode: 'EC2A 3QP', addressCountry: 'GB' }, contactPhone: '+447700900101' },
      { key: 'clapham', name: 'Clapham', share: 0.38, schedule: EN_SCHEDULE_SMALL, address: { addressLine1: '12 Bedford Road', addressCity: 'London', addressPostalCode: 'SW4 7HJ', addressCountry: 'GB' }, contactPhone: '+447700900102' },
    ],
    owner: { first: 'Sarah', last: 'Mitchell', email: 'owner.hq', gender: 'FEMALE', dob: '1984-06-14' },
    coaches: [
      { first: 'Rafael', last: 'Moreira', email: 'coach.hq', branch: 'shoreditch', belt: ['Black Belt', 3], years: 18, head: true, gender: 'MALE', bio: 'Head instructor. Third-degree black belt, IBJJF World Masters medallist.' },
      { first: 'Daniel', last: 'Price', branch: 'shoreditch', belt: ['Black Belt', 1], years: 12, gender: 'MALE', bio: 'Competition team coach.' },
      { first: 'Hannah', last: 'Okafor', branch: 'shoreditch', belt: ['Black Belt', 0], years: 10, kids: true, gender: 'FEMALE', bio: "Leads the kids programme and the women's class." },
      { first: 'Tom', last: 'Fletcher', branch: 'shoreditch', belt: ['Brown Belt', 2], years: 8, gender: 'MALE', bio: 'Fundamentals and lunchtime classes.' },
      { first: 'Priya', last: 'Shah', branch: 'shoreditch', belt: ['Brown Belt', 0], years: 7, kids: true, gender: 'FEMALE', bio: 'Kids coach.' },
      { first: 'Kwame', last: 'Mensah', branch: 'shoreditch', belt: ['Purple Belt', 3], years: 5, gender: 'MALE', bio: 'Morning classes.' },
      { first: 'Luke', last: 'Bennett', branch: 'clapham', belt: ['Black Belt', 2], years: 14, gender: 'MALE', bio: 'Clapham head coach.' },
      { first: 'Megan', last: 'Turner', branch: 'clapham', belt: ['Brown Belt', 1], years: 8, kids: true, gender: 'FEMALE', bio: 'Kids and fundamentals at Clapham.' },
      { first: 'Arjun', last: 'Patel', branch: 'clapham', belt: ['Purple Belt', 2], years: 6, gender: 'MALE', bio: 'Advanced classes at Clapham.' },
      { first: 'Ellie', last: 'Ward', branch: 'clapham', belt: ['Purple Belt', 0], years: 4, kids: true, gender: 'FEMALE', bio: 'Assistant coach, kids classes.' },
    ],
    staff: [
      { first: 'Jade', last: 'Robinson', email: 'desk.hq', branch: 'shoreditch', full: true },
      { first: 'Callum', last: 'Hughes', email: 'desk.clapham', branch: 'clapham', full: false },
    ],
  },
  {
    key: 'manchester', id: 'de300000-0000-4000-8000-000000000012', country: 'GB', currency: 'GBP', language: 'en-GB', timezone: 'Europe/London', names: 'GB',
    name: 'Apex Jiu-Jitsu Manchester', opened: '2021-09-01', students: 245,
    description: 'Apex Jiu-Jitsu in the Northern Quarter: fundamentals, advanced and kids classes.',
    address: { addressLine1: '23 Thomas Street', addressCity: 'Manchester', addressPostalCode: 'M4 1NA', addressCountry: 'GB' }, mobileNumber: '+447700900200',
    branches: [{ key: 'nq', name: 'Northern Quarter', share: 1, schedule: EN_SCHEDULE_SMALL, address: { addressLine1: '23 Thomas Street', addressCity: 'Manchester', addressPostalCode: 'M4 1NA', addressCountry: 'GB' }, contactPhone: '+447700900201' }],
    owner: { first: 'Ryan', last: 'Campbell', email: 'owner.manchester', gender: 'MALE', dob: '1987-02-03' },
    coaches: [
      { first: 'Chris', last: 'Lewis', email: 'coach.manchester', branch: 'nq', belt: ['Black Belt', 1], years: 13, head: true, gender: 'MALE', bio: 'Head coach, Manchester.' },
      { first: 'Zara', last: 'Ahmed', branch: 'nq', belt: ['Brown Belt', 0], years: 7, kids: true, gender: 'FEMALE', bio: 'Kids programme lead.' },
      { first: 'Nathan', last: 'Hall', branch: 'nq', belt: ['Purple Belt', 1], years: 5, gender: 'MALE', bio: 'Morning and fundamentals.' },
    ],
    staff: [{ first: 'Abbie', last: 'Cooper', email: 'desk.manchester', branch: 'nq', full: true }],
  },
  {
    key: 'dublin', id: 'de300000-0000-4000-8000-000000000013', country: 'IE', currency: 'EUR', language: 'en-GB', timezone: 'Europe/Dublin', names: 'IE',
    name: 'Apex Jiu-Jitsu Dublin', opened: '2022-04-01', students: 215,
    description: 'Apex Jiu-Jitsu on the Liffey: BJJ for adults and kids.',
    address: { addressLine1: '7 Ormond Quay Upper', addressCity: 'Dublin', addressPostalCode: 'D07 X2T5', addressCountry: 'IE' }, mobileNumber: '+353850900300',
    branches: [{ key: 'city', name: 'Dublin City', share: 1, schedule: EN_SCHEDULE_SMALL, address: { addressLine1: '7 Ormond Quay Upper', addressCity: 'Dublin', addressPostalCode: 'D07 X2T5', addressCountry: 'IE' }, contactPhone: '+353850900301' }],
    owner: { first: 'Niamh', last: 'Gallagher', email: 'owner.dublin', gender: 'FEMALE', dob: '1989-11-21' },
    coaches: [
      { first: 'Cian', last: 'Byrne', email: 'coach.dublin', branch: 'city', belt: ['Black Belt', 0], years: 11, head: true, gender: 'MALE', bio: 'Head coach, Dublin.' },
      { first: 'Aoife', last: 'Walsh', branch: 'city', belt: ['Purple Belt', 2], years: 6, kids: true, gender: 'FEMALE', bio: 'Kids classes.' },
      { first: 'Darragh', last: 'Doyle', branch: 'city', belt: ['Brown Belt', 1], years: 8, gender: 'MALE', bio: 'Advanced classes.' },
    ],
    staff: [{ first: 'Orla', last: 'Kennedy', email: 'desk.dublin', branch: 'city', full: true }],
  },
  {
    key: 'saopaulo', id: 'de300000-0000-4000-8000-000000000014', country: 'BR', currency: 'BRL', language: 'pt-BR', timezone: 'America/Sao_Paulo', names: 'BR',
    name: 'Apex Jiu-Jitsu São Paulo', opened: '2023-02-01', students: 275, noCards: true,
    description: 'Apex Jiu-Jitsu em Pinheiros: jiu-jitsu para adultos e crianças.',
    address: { addressLine1: 'Rua dos Pinheiros, 870', addressCity: 'São Paulo', addressRegion: 'SP', addressPostalCode: '05422-001', addressCountry: 'BR' }, mobileNumber: '+5511900400400',
    branches: [{ key: 'pinheiros', name: 'Pinheiros', share: 1, schedule: PT_SCHEDULE, address: { addressLine1: 'Rua dos Pinheiros, 870', addressCity: 'São Paulo', addressRegion: 'SP', addressPostalCode: '05422-001', addressCountry: 'BR' }, contactPhone: '+5511900400401' }],
    owner: { first: 'Thiago', last: 'Almeida', email: 'owner.saopaulo', gender: 'MALE', dob: '1985-08-09' },
    coaches: [
      { first: 'Marcelo', last: 'Nascimento', email: 'coach.saopaulo', branch: 'pinheiros', belt: ['Black Belt', 2], years: 16, head: true, gender: 'MALE', bio: 'Professor responsável, faixa-preta 2º grau.' },
      { first: 'Juliana', last: 'Rocha', branch: 'pinheiros', belt: ['Black Belt', 0], years: 10, kids: true, gender: 'FEMALE', bio: 'Coordenadora do kids.' },
      { first: 'Renan', last: 'Teixeira', branch: 'pinheiros', belt: ['Brown Belt', 3], years: 9, gender: 'MALE', bio: 'Treinos da manhã e fundamentos.' },
      { first: 'Igor', last: 'Machado', branch: 'pinheiros', belt: ['Purple Belt', 4], years: 6, gender: 'MALE', bio: 'Equipe de competição.' },
    ],
    staff: [{ first: 'Fernanda', last: 'Lopes', email: 'recepcao.saopaulo', branch: 'pinheiros', full: true }],
  },
];

const WAIVER = {
  en: { title: 'Liability Waiver & Assumption of Risk', body: [
    'Brazilian Jiu-Jitsu is a contact sport. Training involves takedowns, joint locks, chokes and live sparring, and carries a risk of injury.',
    'I confirm that I am in good health and have no medical condition that prevents me from training, or that I have told the instructor about any condition before training.',
    'I agree to follow the instructions of the coaches, tap early, train with control and respect my training partners.',
    'I accept the risks of training and release the academy, its owners and coaches from liability for injuries that happen during normal training, except where caused by negligence.',
    'I consent to receiving first aid and, if needed, emergency medical treatment.',
  ].join('\n\n') },
  pt: { title: 'Termo de Responsabilidade e Ciência de Riscos', body: [
    'O jiu-jitsu brasileiro é um esporte de contato. Os treinos incluem quedas, chaves, estrangulamentos e rola, com risco de lesões.',
    'Declaro estar em boas condições de saúde, ou ter informado o professor sobre qualquer condição antes de treinar.',
    'Comprometo-me a seguir as orientações dos professores, bater cedo, treinar com controle e respeitar meus parceiros de treino.',
    'Assumo os riscos do treino e isento a academia, seus responsáveis e professores de responsabilidade por lesões ocorridas em treino normal, salvo em caso de negligência.',
    'Autorizo primeiros socorros e, se necessário, atendimento médico de emergência.',
  ].join('\n\n') },
};

// ---------------------------------------------------------------- helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One HTTP call to the API. Waits out its rate limit (60 calls a minute per
 * address by default) instead of failing. */
async function call(method, path, headers, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    if (res.status === 429 && attempt < 30) { await sleep(Math.max(2, Number(res.headers.get('retry-after')) || 5) * 1000); continue; }
    return { status: res.status, json };
  }
}

/** Waits for the API (a sleeping free Render instance takes about a minute to wake). */
async function waitForApi() {
  const until = Date.now() + 5 * 60_000;
  for (;;) {
    try { const res = await fetch(`${API}/health`); if (res.ok) return; } catch { /* not up yet */ }
    if (Date.now() > until) throw new Error(`seed-demo.mjs: the API at ${API} did not answer /health within 5 minutes.`);
    await sleep(5000);
  }
}

/** Signs in through the API with the seeded passcode, as the apps do. */
async function login(email) {
  const { status, json } = await call('POST', '/auth/login', {}, { email, passcode: PASSCODE });
  if (status >= 300 || !json?.accessToken) {
    throw new Error(`seed-demo.mjs: signing in as ${email} through ${API} failed (${status} ${JSON.stringify(json)}). Is that API using this same database?`);
  }
  return json.accessToken;
}

/** A signed-in session for one account; signs in again when the access token runs out. */
const session = (email) => ({ email, token: null });

async function api(method, path, who, body) {
  for (let attempt = 0; ; attempt++) {
    who.token ??= await login(who.email);
    const { status, json } = await call(method, path, { authorization: `Bearer ${who.token}` }, body);
    if (status === 401 && attempt < 2) { who.token = null; continue; }
    if (status >= 300) throw new Error(`${method} ${path} -> ${status} ${typeof json === 'string' ? json : JSON.stringify(json)}`);
    return json;
  }
}

/** A wall-clock time on a local day in a zone, as a Date. */
const localAt = (zone, day, hhmm) => { const [h, m] = hhmm.split(':').map(Number); return DateTime.fromISO(day, { zone }).set({ hour: h, minute: m }).toJSDate(); };
const localDay = (zone, date) => DateTime.fromJSDate(date, { zone }).toISODate();
const weekKey = (zone, date) => DateTime.fromJSDate(date, { zone }).startOf('week').toISODate();
const dateOnly = (iso) => new Date(`${iso}T00:00:00.000Z`);
const dob = (ageLo, ageHi) => { const d = new Date(NOW.getTime() - (ageLo * 365.25 + rand() * (ageHi - ageLo) * 365.25) * DAY); return dateOnly(d.toISOString().slice(0, 10)); };

// ---------------------------------------------------------------- wipe
async function wipe() {
  const schools = await db.school.findMany({ where: { OR: [{ franchiseId: FRANCHISE_ID }, { id: { in: SCHOOLS.map((s) => s.id) } }] }, select: { id: true } });
  const schoolIds = schools.map((s) => s.id);
  const users = await db.$queryRaw`
    SELECT id FROM "User" WHERE email LIKE ${'%@' + DOMAIN}
    UNION SELECT u.id FROM "User" u JOIN "GuardianLink" g ON g."studentId" = u.id JOIN "User" p ON p.id = g."guardianId"
      WHERE u.email LIKE ${'minor+%@' + MINOR_DOMAIN} AND p.email LIKE ${'%@' + DOMAIN}`;
  const userIds = users.map((u) => u.id);
  const franchise = await db.franchise.findUnique({ where: { id: FRANCHISE_ID }, select: { id: true } });
  if (!schoolIds.length && !userIds.length && !franchise) return log('wipe: nothing to remove');
  log(`wipe: ${schoolIds.length} Schools, ${userIds.length} accounts`);

  // Every row that is, or depends on, a demo School, the demo Franchise or a
  // demo account: found by following the foreign keys, then deleted children
  // first. Works as an ordinary (non-superuser) database owner.
  const fks = await db.$queryRaw`
    SELECT con.conrelid::regclass::text AS child, a.attname AS col, con.confrelid::regclass::text AS parent, pa.attname AS pcol
    FROM pg_constraint con
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
    JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = con.confkey[1]
    WHERE con.contype = 'f' AND array_length(con.conkey, 1) = 1 AND con.connamespace = 'public'::regnamespace`;
  const cols = await db.$queryRaw`SELECT format('%I', table_name) AS t, column_name AS c FROM information_schema.columns WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'`;
  const hasId = new Set(cols.filter((r) => r.c === 'id').map((r) => r.t));
  const doomed = new Map(); // table -> Set of ids
  const add = (t, ids) => { const s = doomed.get(t) ?? new Set(); const n = s.size; ids.forEach((i) => s.add(i)); doomed.set(t, s); return s.size > n; };
  add('"School"', schoolIds); add('"User"', userIds); if (franchise) add('"Franchise"', [FRANCHISE_ID]);
  for (const { t, c } of cols) {
    if (!hasId.has(t) || (c !== 'schoolId' && c !== 'franchiseId')) continue;
    const ids = c === 'schoolId' ? schoolIds : [FRANCHISE_ID];
    if (ids.length) add(t, (await db.$queryRawUnsafe(`SELECT id FROM ${t} WHERE "${c}" = ANY($1::text[])`, ids)).map((r) => r.id));
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const fk of fks) {
      const parentIds = doomed.get(fk.parent);
      if (fk.pcol !== 'id' || !parentIds?.size || !hasId.has(fk.child)) continue;
      const rows = await db.$queryRawUnsafe(`SELECT id FROM ${fk.child} WHERE "${fk.col}" = ANY($1::text[])`, [...parentIds]);
      if (add(fk.child, rows.map((r) => r.id))) changed = true;
    }
  }
  await db.$transaction(async (tx) => {
    for (let pass = 0; [...doomed.values()].some((s) => s.size); pass++) {
      if (pass > 40) throw new Error(`wipe: could not order the deletes; left: ${[...doomed].filter(([, s]) => s.size).map(([t]) => t).join(', ')}`);
      // Link tables without an id column go with whatever they point at.
      for (const fk of fks) {
        if (hasId.has(fk.child) || !doomed.get(fk.parent)?.size) continue;
        await tx.$executeRawUnsafe(`DELETE FROM ${fk.child} WHERE "${fk.col}" = ANY($1::text[])`, [...doomed.get(fk.parent)]);
      }
      for (const [t, ids] of doomed) {
        if (!ids.size) continue;
        await tx.$executeRawUnsafe('SAVEPOINT demo_wipe');
        try {
          await tx.$executeRawUnsafe(`DELETE FROM ${t} WHERE id = ANY($1::text[])`, [...ids]);
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT demo_wipe');
          ids.clear();
        } catch {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT demo_wipe'); // still referenced: next pass
        }
      }
    }
  }, { timeout: 15 * 60_000, maxWait: 60_000 });
  log('wipe: done');
}

// ---------------------------------------------------------------- main
async function main() {
  // DEMO_KEEP_EXISTING=1: leave a demo that's already there as it is.
  if (process.env.DEMO_KEEP_EXISTING === '1' && (await db.franchise.findUnique({ where: { id: FRANCHISE_ID }, select: { id: true } }))) {
    return log('the demo is already there and DEMO_KEEP_EXISTING=1: nothing changed. Re-seed to rebuild it, dated from today.');
  }
  await waitForApi();
  await wipe();
  const legal = Object.fromEntries((await db.legalDocument.findMany({ select: { slug: true, version: true } })).map((r) => [r.slug, r.version]));
  const ver = (slug) => legal[slug] ?? 'unpublished';
  const passcodeHash = await bcrypt.hash(PASSCODE, 12);

  // Every row we write, collected per table and inserted in bulk.
  const users = []; const grants = []; const legalRows = [];
  const usedEmails = new Set(); let phoneN = 0;
  const phoneFor = (country) => {
    phoneN++;
    if (country === 'GB') return `+4477009${String(phoneN).padStart(5, '0')}`;
    if (country === 'IE') return `+3538509${String(phoneN).padStart(5, '0')}`;
    return `+55119004${String(phoneN).padStart(5, '0')}`;
  };
  const mkUser = ({ first, last, email, country, language, currency, gender, dateOfBirth, createdAt, city, legalAccepted = true, minor = false }) => {
    const id = randomUUID();
    let em = email;
    if (minor) em = `minor+${id}@${MINOR_DOMAIN}`;
    else if (!em) { let base = `${strip(first)}.${strip(last)}`; em = `${base}@${DOMAIN}`; let n = 2; while (usedEmails.has(em)) em = `${base}${n++}@${DOMAIN}`; }
    else em = `${em}@${DOMAIN}`;
    usedEmails.add(em);
    const phone = minor ? `+000${String(Math.floor(rand() * 1e12)).padStart(12, '0')}` : phoneFor(country);
    const emergency = !minor && chance(0.7) ? { emergencyContactName: `${pick(NAMES[country === 'BR' ? 'BR' : country === 'IE' ? 'IE' : 'GB'][chance(0.5) ? 'm' : 'f'])} ${last}`, emergencyContactPhone: phoneFor(country), emergencyContactRelationship: pick(country === 'BR' ? ['Mãe', 'Pai', 'Cônjuge', 'Irmão'] : ['Partner', 'Mother', 'Father', 'Sibling', 'Friend']) } : {};
    const u = { id, ...emergency, email: em, phone, firstName: first, surname: last, passcodeHash, phoneVerifiedAt: minor ? null : createdAt, dateOfBirth, gender, nationality: country, language, currency, addressCity: city ?? null, addressCountry: country, createdAt, updatedAt: createdAt };
    users.push(u);
    // Signed up themselves (the sign-up's Terms and Privacy tick): no first-sign-in "I agree".
    if (!minor && legalAccepted) for (const slug of ['terms-and-conditions', 'privacy-statement']) legalRows.push({ id: randomUUID(), userId: id, documentSlug: slug, version: ver(slug), atFirstSignIn: false, acceptedAt: createdAt });
    return u;
  };
  const grant = (userId, role, { schoolId = null, branchId = null, franchiseId = null, at = NOW, isMainOwner = false, revokedAt = null } = {}) => {
    const g = { id: randomUUID(), userId, role, schoolId, branchId, franchiseId, grantedAt: at, createdAt: at, updatedAt: at, isMainOwner, revokedAt };
    grants.push(g); return g;
  };

  // ---- Franchise and its owner (the founder)
  const founder = mkUser({ first: 'Marcus', last: 'Reid', email: 'founder', country: 'GB', language: 'en-GB', currency: 'GBP', gender: 'MALE', dateOfBirth: dateOnly('1979-04-22'), createdAt: new Date('2016-01-10T10:00:00Z'), city: 'London' });
  await db.franchise.create({ data: { id: FRANCHISE_ID, name: 'Apex Jiu-Jitsu', type: 'Martial arts academy', activities: ['Brazilian Jiu-Jitsu'], facilities: ['Changing rooms', 'Showers', 'Kids area'], defaultLanguage: 'en-GB', defaultCurrency: 'GBP', description: 'Apex Jiu-Jitsu: a family of Brazilian Jiu-Jitsu academies in London, Manchester, Dublin and São Paulo.', addressLine1: '48 Rivington Street', addressCity: 'London', addressPostalCode: 'EC2A 3QP', addressCountry: 'GB', mobileNumber: '+447700900001', shareBrandingWithMembers: true, createdAt: new Date('2016-01-10T10:00:00Z') } });
  legalRows.push({ id: randomUUID(), userId: founder.id, documentSlug: 'school-agreement', version: ver('school-agreement'), franchiseId: FRANCHISE_ID, atFirstSignIn: false, acceptedAt: new Date('2016-01-10T10:00:00Z') });
  grant(founder.id, 'FRANCHISE_OWNER', { franchiseId: FRANCHISE_ID, at: new Date('2016-01-10T10:00:00Z') });

  const world = []; // per-School state for the later phases
  for (const S of SCHOOLS) {
    const opened = new Date(`${S.opened}T09:00:00Z`);
    const lang = S.language;
    const ctx = { S, opened, branches: [], coaches: [], staff: [], students: [], guardians: [], kidsOf: new Map() };
    world.push(ctx);
    await db.school.create({ data: {
      id: S.id, franchiseId: FRANCHISE_ID, name: S.name, description: S.description, mobileNumber: S.mobileNumber, ...S.address,
      businessType: 'Martial arts academy', activities: ['Brazilian Jiu-Jitsu'], facilities: ['Changing rooms', 'Showers', 'Kids area'],
      ranksToggle: true, showFranchiseBranding: true, defaultLanguage: lang, defaultCurrency: S.currency, timezone: S.timezone,
      classCancellationPolicy: 'AUTO_CREDIT', cancellationPolicyChosenAt: opened, defaultRefundCutoffHours: 2,
      footerContactEmail: `hello.${S.key}@${DOMAIN}`, footerContactPhone: S.mobileNumber, footerInstagramUrl: 'https://instagram.com/apexjiujitsu.demo',
      footerAboutUs: S.description, heardFromOptions: lang === 'pt-BR' ? ['Instagram', 'Google', 'Indicação de amigo', 'Passei na frente'] : ['Instagram', 'Google', 'A friend', 'Walked past'],
      taxCountry: S.country, memberAppGradingCountdown: true, nextGradingDate: dateOnly(DateTime.now().plus({ days: 24 }).toISODate()),
      createdAt: opened,
    } });
    for (const B of S.branches) {
      const b = await db.branch.create({ data: { id: randomUUID(), schoolId: S.id, name: B.name, ...B.address, contactPhone: B.contactPhone, timezone: S.timezone, defaultLanguage: lang, type: 'Academy', activities: ['Brazilian Jiu-Jitsu'], createdAt: opened } });
      ctx.branches.push({ ...B, id: b.id });
    }
    const branchByKey = Object.fromEntries(ctx.branches.map((b) => [b.key, b]));
    await db.paymentAccount.create({ data: S.noCards
      ? { id: randomUUID(), schoolId: S.id, provider: 'BANK_TRANSFER', accountTitle: 'Pix', country: S.country, status: 'ACTIVE', mode: 'TEST' }
      : { id: randomUUID(), schoolId: S.id, provider: 'STRIPE', accountTitle: 'Stripe', country: S.country, status: 'ACTIVE', mode: 'TEST', stripeConnectedAccountId: `acct_${hex(8)}`, stripeAccountReady: true, stripeAccountReadyCheckedAt: daysAgo(3) } });
    ctx.paymentAccount = await db.paymentAccount.findUnique({ where: { schoolId: S.id } });

    // Owner
    const o = S.owner;
    ctx.owner = mkUser({ first: o.first, last: o.last, email: o.email, country: S.country, language: lang, currency: S.currency, gender: o.gender, dateOfBirth: dateOnly(o.dob), createdAt: opened, city: S.address.addressCity });
    grant(ctx.owner.id, 'SCHOOL_OWNER_MANAGER', { schoolId: S.id, at: opened, isMainOwner: true });
    legalRows.push({ id: randomUUID(), userId: ctx.owner.id, documentSlug: 'school-agreement', version: ver('school-agreement'), schoolId: S.id, atFirstSignIn: false, acceptedAt: opened });

    // Coaches
    for (const [i, c] of S.coaches.entries()) {
      const at = new Date(opened.getTime() + i * 40 * DAY);
      const u = mkUser({ first: c.first, last: c.last, email: c.email, country: S.country, language: lang, currency: S.currency, gender: c.gender, dateOfBirth: dob(26, 44), createdAt: at, city: S.address.addressCity });
      const branch = branchByKey[c.branch];
      grant(u.id, 'INSTRUCTOR', { schoolId: S.id, branchId: branch.id, at, revokedAt: null });
      ctx.coaches.push({ ...c, user: u, branchId: branch.id, at });
    }
    // Front desk (Branch Staff)
    for (const st of S.staff) {
      const at = new Date(Math.max(opened.getTime(), NOW.getTime() - between(200, 900) * DAY));
      const u = mkUser({ first: st.first, last: st.last, email: st.email, country: S.country, language: lang, currency: S.currency, gender: chance(0.5) ? 'FEMALE' : 'MALE', dateOfBirth: dob(21, 35), createdAt: at, city: S.address.addressCity });
      grant(u.id, 'BRANCH_STAFF', { schoolId: S.id, branchId: branchByKey[st.branch].id, at });
      ctx.staff.push({ ...st, user: u, branchId: branchByKey[st.branch].id, at });
    }

    // Members: adults (some of them parents) and children (with a parent).
    const N = S.students; const nKids = Math.round(N * 0.3); const nAdults = N - nKids;
    const nm = NAMES[S.names];
    const ageYears = (NOW.getTime() - opened.getTime()) / (365.25 * DAY);
    const joinDate = () => {
      // Skewed towards recent joiners; nobody before the School opened.
      const yearsBack = Math.min(ageYears, Math.pow(rand(), 1.35) * ageYears);
      return new Date(NOW.getTime() - Math.max(1, yearsBack * 365.25) * DAY - between(0, 12) * 3600e3);
    };
    const pickBranch = () => { let r = rand(); for (const b of ctx.branches) { if ((r -= b.share) <= 0) return b; } return ctx.branches[0]; };
    for (let i = 0; i < nAdults; i++) {
      const gender = chance(0.72) ? 'MALE' : 'FEMALE';
      const first = pick(gender === 'MALE' ? nm.m : nm.f); const last = pick(nm.s);
      const newbie = chance(0.025); // joined in the last days: trials and drop-ins
      const joined = newbie ? new Date(NOW.getTime() - between(1, 9) * DAY - between(0, 10) * 3600e3) : joinDate();
      const u = mkUser({ first, last, country: S.country, language: lang, currency: S.currency, gender, dateOfBirth: dob(18, 52), createdAt: joined, city: S.address.addressCity });
      const branch = pickBranch();
      grant(u.id, 'STUDENT', { schoolId: S.id, branchId: null, at: joined });
      ctx.students.push({ user: u, kind: 'adult', joined, branch, newbie });
    }
    // Parents: about 70% of the children's parents don't train themselves.
    let made = 0;
    while (made < nKids) {
      const nChildren = chance(0.3) ? 2 : 1;
      const parentTrains = chance(0.3);
      const last = pick(nm.s);
      const pg = chance(0.6) ? 'FEMALE' : 'MALE';
      const firstKidJoined = joinDate();
      let parent;
      if (parentTrains) {
        const adults = ctx.students.filter((s) => s.kind === 'adult' && !s.isParent);
        const p = pick(adults); p.isParent = true; parent = p.user; parent.surname = p.user.surname;
      } else {
        parent = mkUser({ first: pick(pg === 'MALE' ? nm.m : nm.f), last, country: S.country, language: lang, currency: S.currency, gender: pg, dateOfBirth: dob(32, 50), createdAt: new Date(firstKidJoined.getTime() - DAY), city: S.address.addressCity });
      }
      ctx.guardians.push(parent);
      const branch = pickBranch();
      for (let k = 0; k < nChildren && made < nKids; k++, made++) {
        const gender = chance(0.6) ? 'MALE' : 'FEMALE';
        const born = dob(5, 15.5);
        // Nobody starts before they're four.
        const fourth = born.getTime() + (4 * 365.25 + between(0, 400)) * DAY;
        const joined = new Date(Math.max(fourth, k === 0 ? firstKidJoined.getTime() : firstKidJoined.getTime() + between(0, 200) * DAY));
        const child = mkUser({ first: pick(gender === 'MALE' ? nm.m : nm.f), last: parent.surname, minor: true, country: S.country, language: lang, currency: S.currency, gender, dateOfBirth: born, createdAt: new Date(Math.min(joined.getTime(), NOW.getTime() - DAY)) });
        grant(child.id, 'STUDENT', { schoolId: S.id, at: child.createdAt });
        ctx.students.push({ user: child, kind: 'kid', joined: child.createdAt, branch, guardian: parent });
        if (!ctx.kidsOf.has(parent.id)) ctx.kidsOf.set(parent.id, []);
        ctx.kidsOf.get(parent.id).push(child);
      }
    }
  }

  // ---- The named demo members (README): adult member, parent, a new member
  // still at the first-sign-in "I agree", and a Brazilian member.
  const hq = world[0]; const sp = world[3];
  const namedAdult = hq.students.find((s) => s.kind === 'adult' && !s.isParent && s.branch.key === 'shoreditch');
  Object.assign(namedAdult.user, { email: `member@${DOMAIN}`, firstName: 'James', surname: 'Carter', gender: 'MALE', dateOfBirth: dateOnly('1992-09-12') });
  namedAdult.named = 'member'; namedAdult.joined = namedAdult.user.createdAt = daysAgo(430);
  const namedParentKid = hq.students.find((s) => s.kind === 'kid' && s.branch.key === 'shoreditch' && !hq.students.some((x) => x.user.id === s.guardian.id));
  Object.assign(namedParentKid.guardian, { email: `parent@${DOMAIN}`, firstName: 'Emma', surname: 'Clarke', gender: 'FEMALE', dateOfBirth: dateOnly('1985-03-02') });
  for (const kid of hq.kidsOf.get(namedParentKid.guardian.id)) kid.surname = 'Clarke';
  namedParentKid.named = 'child';
  const namedBr = sp.students.find((s) => s.kind === 'adult' && !s.isParent);
  Object.assign(namedBr.user, { email: `aluno@${DOMAIN}`, firstName: 'Lucas', surname: 'Ferreira', gender: 'MALE', dateOfBirth: dateOnly('1995-01-17') });
  namedBr.named = 'aluno';
  // The new member: created by the front desk (no own Terms tick yet), so their
  // first sign-in shows the "I agree" step (Decision 448 item 8).
  const fresh = hq.students.find((s) => s.kind === 'adult' && !s.isParent && !s.named && s.branch.key === 'shoreditch');
  Object.assign(fresh.user, { email: `new.member@${DOMAIN}`, firstName: 'Noah', surname: 'Bailey', gender: 'MALE', dateOfBirth: dateOnly('1998-07-30') });
  fresh.named = 'fresh'; fresh.joined = fresh.user.createdAt = daysAgo(2);
  for (let i = legalRows.length - 1; i >= 0; i--) if (legalRows[i].userId === fresh.user.id) legalRows.splice(i, 1);
  for (const g of grants) if (g.userId === fresh.user.id) g.grantedAt = g.createdAt = fresh.joined;
  for (const g of grants) if (g.userId === namedAdult.user.id) g.grantedAt = g.createdAt = namedAdult.joined;

  log(`inserting ${users.length} accounts and ${grants.length} role grants`);
  await chunked(users, (rows) => db.user.createMany({ data: rows }));
  await chunked(legalRows, (rows) => db.legalAcceptance.createMany({ data: rows }));
  await chunked(grants, (rows) => db.roleGrant.createMany({ data: rows }));

  // Home branches, join dates (the RoleGrant trigger wrote today's), guardians.
  const homeRows = []; const linkRows = []; const consentRows = [];
  for (const ctx of world) {
    for (const st of ctx.students) homeRows.push({ id: randomUUID(), schoolId: ctx.S.id, studentId: st.user.id, branchId: st.branch.id, assignedById: ctx.owner.id, createdAt: st.joined });
    for (const g of ctx.guardians) for (const kid of ctx.kidsOf.get(g.id) ?? []) {
      linkRows.push({ id: randomUUID(), guardianId: g.id, studentId: kid.id, createdAt: kid.createdAt });
      consentRows.push({ id: randomUUID(), guardianId: g.id, studentId: kid.id, tier: 'BASELINE', policyVersion: ver('children-notice'), consentedAt: kid.createdAt });
      if (chance(0.85)) consentRows.push({ id: randomUUID(), guardianId: g.id, studentId: kid.id, tier: 'CAMERA', policyVersion: ver('children-notice'), consentedAt: kid.createdAt });
    }
  }
  await chunked(homeRows, (rows) => db.studentHomeBranch.createMany({ data: rows }));
  await chunked(linkRows, (rows) => db.guardianLink.createMany({ data: rows }));
  await chunked(consentRows, (rows) => db.consentRecord.createMany({ data: rows }));
  for (const ctx of world) {
    await db.$executeRawUnsafe(`UPDATE "StudentJoinDate" j SET "joinedOn" = (g."grantedAt" AT TIME ZONE $2)::date FROM "RoleGrant" g
      WHERE g."userId" = j."studentId" AND g."schoolId" = j."schoolId" AND g.role = 'STUDENT' AND j."schoolId" = $1`, ctx.S.id, ctx.S.timezone);
  }

  // Instructor profiles, staff permissions.
  for (const ctx of world) {
    await db.instructor.createMany({ data: ctx.coaches.map((c) => ({ id: randomUUID(), userId: c.user.id, schoolId: ctx.S.id, branchId: c.branchId, yearsOfExperience: c.years, bio: c.bio, phone: c.user.phone, activities: ['Brazilian Jiu-Jitsu'], specializations: ['Brazilian Jiu-Jitsu'], createdAt: c.at })) });
    await db.staffPermission.createMany({ data: ctx.staff.map((st) => ({
      id: randomUUID(), schoolId: ctx.S.id, userId: st.user.id, grantedById: ctx.owner.id, displayName: `${st.first} (front desk)`,
      canManageBookings: true, canManageStudents: true, canCancelClasses: st.full, canManageClasses: st.full, canSeeStaffList: st.full,
      canStartOpenMat: true, canManageCheckInRules: st.full, canCreateCharges: st.full, canFreezeMemberships: st.full,
      canSeeAttendanceStats: true, canExportStudents: false, canSeeMedicalInfo: st.full,
    })) });
  }
  log('people done');

  // ---- Through the API, as each owner: styles, plans, waiver, timetable.
  await sleep(1200); // tokens must postdate the grants (rolesChangedAt)
  for (const ctx of world) {
    const { S } = ctx;
    const tok = session(ctx.owner.email);
    ctx.tok = tok;
    const isPt = S.language === 'pt-BR';
    const adult = await api('POST', `/schools/${S.id}/disciplines/from-template`, tok, { templateId: 'ibjjf', name: isPt ? 'Jiu-Jitsu Adulto' : 'Brazilian Jiu-Jitsu' });
    const kids = await api('POST', `/schools/${S.id}/disciplines/from-template`, tok, { templateId: 'ibjjf', name: isPt ? 'Jiu-Jitsu Kids' : 'Kids BJJ' });
    // Kids and Adult are two programs (Decision 281): the kids ladder keeps the
    // kids belts, the adult ladder the adult ones; a kid moves to the adult
    // program at the School's "Ready for Adult" age. Belts nobody holds yet
    // are archived, as an owner would in the ladder editor.
    const adultRanks = await db.rank.findMany({ where: { disciplineId: adult.id }, orderBy: { order: 'asc' } });
    const kidsRanks = await db.rank.findMany({ where: { disciplineId: kids.id }, orderBy: { order: 'asc' } });
    const isKidsBelt = (r) => /Grey|Yellow|Orange|Green/.test(r.name) || /Cinza|Amarela|Laranja|Verde/.test(r.name);
    const isAdultOnly = (r) => !isKidsBelt(r) && r.order > 0;
    await db.rank.updateMany({ where: { id: { in: adultRanks.filter(isKidsBelt).map((r) => r.id) } }, data: { archivedAt: NOW } });
    await db.rank.updateMany({ where: { id: { in: kidsRanks.filter(isAdultOnly).map((r) => r.id) } }, data: { archivedAt: NOW } });
    // Adult white belts train in adult classes: their stripes count Adult Fundamentals.
    await db.rankStripeTier.updateMany({ where: { rankId: adultRanks[0].id }, data: { eligibleClassTypes: ['Adult Fundamentals'] } });
    await api('PATCH', `/disciplines/${kids.id}`, tok, { adultDisciplineId: adult.id });
    ctx.disc = { adult: adult.id, kids: kids.id };
    ctx.ladder = {};
    for (const [k, id] of Object.entries(ctx.disc)) {
      const ranks = await db.rank.findMany({ where: { disciplineId: id, archivedAt: null }, orderBy: { order: 'asc' }, include: { stripeTiers: { orderBy: { order: 'asc' } } } });
      ctx.ladder[k] = ranks.flatMap((r) => r.stripeTiers.map((t) => ({ rankId: r.id, rankName: r.name, rankOrder: r.order, tierId: t.id, stripes: t.order, name: t.name, classesRequired: t.classesRequired, minDays: t.minimumDaysInRank ?? 0, eligible: t.eligibleClassTypes, cap: t.weeklyClassCountCap, timeOnly: t.timeOnly })));
    }

    // Membership plans.
    ctx.plans = {};
    for (const p of PLAN_SETS[S.currency]) {
      const body = { type: p.type, title: p.title, price: p.price, currency: S.currency, disciplineIds: p.disc.map((d) => ctx.disc[d]) };
      if (p.classesIncluded) body.classesIncluded = p.classesIncluded;
      if (p.expiryDurationDays) body.expiryDurationDays = p.expiryDurationDays;
      if (p.includesLessons !== undefined) body.includesLessons = p.includesLessons;
      if (p.type === 'FRIEND_PASS') body.visible = false;
      const plan = await api('POST', `/schools/${S.id}/membership-plans`, tok, body);
      ctx.plans[p.key] = { ...p, id: plan.id };
    }
    await db.membershipPlan.updateMany({ where: { schoolId: S.id }, data: { createdAt: ctx.opened } });

    // Waiver.
    const w = isPt ? WAIVER.pt : WAIVER.en;
    const waiver = await api('POST', `/schools/${S.id}/waivers`, tok, { title: w.title, body: w.body });
    ctx.waiver = { id: waiver.id, ...w, version: waiver.version ?? 1 };

    // Weekly timetable.
    ctx.slots = [];
    for (const B of ctx.branches) {
      const branchCoaches = ctx.coaches.filter((c) => c.branchId === B.id);
      const kidsCoaches = branchCoaches.filter((c) => c.kids);
      const adultCoaches = branchCoaches.filter((c) => !c.kids || c.head);
      let rr = 0;
      for (const cls of B.schedule) {
        for (const d of cls.days) {
          const pool = cls.kids ? (kidsCoaches.length ? kidsCoaches : branchCoaches) : cls.type === 'Competition Team' ? branchCoaches.filter((c) => c.head || /Black/.test(c.belt[0])) : adultCoaches;
          const coach = cls.audience === 'WOMEN' ? (branchCoaches.find((c) => c.gender === 'FEMALE') ?? pool[0]) : pool[rr++ % pool.length];
          const weekday = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'][d - 1];
          const slot = await api('POST', `/schools/${S.id}/timetable`, tok, {
            branchId: B.id, instructorId: coach.user.id, weekday, startTime: cls.start, endTime: cls.end, title: cls.title,
            styles: [{ disciplineId: ctx.disc[cls.disc], classType: cls.type }], capacity: cls.cap, membershipInclusion: true,
            ...(cls.audience ? { audience: cls.audience } : {}),
            ...(cls.kids ? { minAge: 4, maxAge: 15 } : {}),
          });
          ctx.slots.push({ id: slot.id, ...cls, weekday: d, branchId: B.id, coachId: coach.user.id });
        }
      }
    }
    log(`${S.name}: 2 styles, ${Object.keys(ctx.plans).length} plans, waiver, ${ctx.slots.length} weekly classes`);
  }

  // ---- Classes: making each weekly class (above) made its coming weeks, as
  // the class generator job does; with REDIS_URL set, the job is also run.
  // The past weeks are the same slots' occurrences, back-dated.
  const slotIds = world.flatMap((c) => c.slots.map((s) => s.id));
  const q = process.env.REDIS_URL ? new (require('bullmq').Queue)('class-occurrence-generation', { connection: { url: process.env.REDIS_URL } }) : null;
  if (q) await q.add('run', {});
  for (let i = 0; ; i++) {
    const n = await db.class.count({ where: { timetableSlotId: { in: slotIds } } });
    if (n >= slotIds.length * 3) { log(`upcoming classes: ${n}`); break; }
    if (i > (q ? 120 : 10)) throw new Error(`seed-demo.mjs: only ${n} upcoming classes for ${slotIds.length} weekly classes. The API at ${API} should make each new weekly class's coming weeks: is it running the latest master?`);
    await sleep(1000);
  }
  if (q) await q.close();

  const classRows = [];
  for (const ctx of world) {
    const zone = ctx.S.timezone;
    const generated = await db.class.findMany({ where: { schoolId: ctx.S.id, timetableSlotId: { not: null } }, orderBy: { startDate: 'asc' } });
    const firstBySlot = new Map();
    for (const c of generated) if (!firstBySlot.has(c.timetableSlotId)) firstBySlot.set(c.timetableSlotId, c);
    const have = new Set(generated.map((c) => `${c.timetableSlotId}|${c.occurrenceDate.toISOString().slice(0, 10)}`));
    for (const [slotId, c] of firstBySlot) {
      const slot = ctx.slots.find((s) => s.id === slotId);
      for (let k = 1; k <= HISTORY_WEEKS + 1; k++) {
        const day = DateTime.fromJSDate(c.occurrenceDate, { zone: 'UTC' }).minus({ weeks: k }).toISODate();
        if (have.has(`${slotId}|${day}`)) continue;
        const startDate = localAt(zone, day, slot.start); const endDate = localAt(zone, day, slot.end);
        if (endDate > NOW && startDate > NOW) continue;
        const { id, createdAt, updatedAt, ...rest } = c;
        classRows.push({ ...rest, id: randomUUID(), occurrenceDate: dateOnly(day), startDate, endDate,
          bookingEndAt: c.bookingEndAt ? new Date(startDate.getTime() - (c.startDate.getTime() - c.bookingEndAt.getTime())) : null,
          qrAttendanceEndAt: c.qrAttendanceEndAt ? new Date(endDate.getTime() + (c.qrAttendanceEndAt.getTime() - c.endDate.getTime())) : null,
          refundFeeDate: c.refundFeeDate ? new Date(startDate.getTime() - (c.startDate.getTime() - c.refundFeeDate.getTime())) : null,
          styles: c.styles ?? [], createdAt: daysAgo(HISTORY_WEEKS * 7 + 14), updatedAt: daysAgo(HISTORY_WEEKS * 7 + 14) });
        have.add(`${slotId}|${day}`);
      }
    }
  }
  await chunked(classRows, (rows) => db.class.createMany({ data: rows }), 1000);
  log(`back-dated ${classRows.length} past classes`);

  // ---- Memberships, payments, attendance, ranks, waivers.
  const memberships = []; const transactions = []; const bookings = []; const trainingLogs = [];
  const studentRanks = []; const events = []; const signatures = []; const freezes = []; const instructorBelts = []; const gradingPerms = []; const notifications = [];
  const stats = {};
  for (const ctx of world) {
    const { S } = ctx; const zone = S.timezone; const pa = ctx.paymentAccount;
    const st = (stats[S.name] = { students: ctx.students.length, adults: 0, kids: 0, coaches: ctx.coaches.length, frontDesk: ctx.staff.length, guardians: ctx.guardians.length, memberships: 0, activeMemberships: 0, transactions: 0, bookings: 0, checkIns: 0, upcomingBookings: 0, classes: 0 });
    const classes = await db.class.findMany({ where: { schoolId: S.id }, select: { id: true, startDate: true, endDate: true, branchId: true, styles: true, capacity: true, audience: true, timetableSlotId: true, instructorId: true }, orderBy: { startDate: 'asc' } });
    st.classes = classes.length;
    const slotById = new Map(ctx.slots.map((s) => [s.id, s]));
    for (const c of classes) { c.slot = slotById.get(c.timetableSlotId); c.count = 0; c.week = weekKey(zone, c.startDate); }
    const histStart = daysAgo(HISTORY_WEEKS * 7);
    const deskStaff = ctx.staff[0]?.user ?? ctx.owner;
    const headCoach = ctx.coaches.find((c) => c.head).user;
    const cardSchool = !S.noCards;
    const money = (p) => p.price;

    for (const s of ctx.students) {
      const isKid = s.kind === 'kid';
      s.isKid = isKid; if (isKid) st.kids++; else st.adults++;
      const plans = ctx.plans;
      // What this member has now.
      let profile;
      if (s.named === 'member') profile = 'monthly';
      else if (s.named === 'child') profile = 'monthly';
      else if (s.named === 'aluno') profile = 'monthly';
      else if (s.named === 'fresh') profile = 'trial';
      else if (s.newbie) profile = weighted([['trial', 70], ['dropin', 15], ['monthly', 15]]);
      else profile = isKid
        ? weighted([['monthly', 80], ['pack', 8], ['lapsed', 12]])
        : weighted([['monthly', 66], ['pack', 11], ['dropin', 2], ['lapsed', 15], ['cancelling', 3], ['frozen', 3]]);
      if (profile === 'trial' && s.joined < daysAgo(6)) profile = 'monthly';
      if (profile === 'lapsed' && s.joined > daysAgo(75)) profile = 'monthly';
      if (!cardSchool && (profile === 'cancelling' || profile === 'frozen')) profile = 'monthly';
      s.profile = profile;
      const plan = isKid ? (profile === 'pack' ? plans.pack10 : plans.kids) : ({ monthly: plans.unlimited, cancelling: plans.unlimited, frozen: plans.unlimited, lapsed: plans.unlimited, pack: plans.pack10, dropin: plans.dropin, trial: plans.trial })[profile];
      const payer = isKid ? s.guardian : s.user;
      const recurring = plan.type === 'SUBSCRIPTION';
      s.memberships = []; // {id, start, end, kind}
      const tx = (m, at, amount, kind, status, extra = {}) => {
        const method = extra.method ?? (cardSchool ? (recurring || chance(0.7) ? 'STRIPE' : 'CASH') : (chance(0.72) ? 'PIX' : 'CASH'));
        transactions.push({ id: randomUUID(), schoolId: S.id, studentId: s.user.id, paymentAccountId: pa.id, membershipPlanId: plan.id, membershipId: m?.id ?? null, kind, billingDate: at, amount, currency: S.currency, status, paymentMethod: method,
          recordedById: method === 'STRIPE' ? null : (status === 'PENDING' ? null : deskStaff.id),
          stripePaymentIntentId: method === 'STRIPE' ? `pi_${hex()}` : null, stripeInvoiceId: method === 'STRIPE' && recurring ? `in_${hex()}` : null,
          stripeSubscriptionId: m?.stripeSubscriptionId ?? null, createdAt: at, updatedAt: at, ...extra.data });
        st.transactions++;
      };
      const mem = (start, data) => { const m = { id: randomUUID(), studentId: s.user.id, membershipPlanId: plan.id, schoolId: S.id, startDate: start, frequency: recurring ? 'RECURRING' : 'ONE_TIME', createdAt: start, updatedAt: start, ...data }; memberships.push(m); st.memberships++; if (m.status === 'ACTIVE') st.activeMemberships++; return m; };

      if (recurring) {
        // A card Subscription since joining (or since an earlier plan ran out).
        const start = profile === 'lapsed' ? new Date(Math.max(s.joined.getTime(), daysAgo(between(120, 400)).getTime())) : s.joined;
        const lapsedEnd = profile === 'lapsed' ? daysAgo(between(10, 75)) : null;
        const end = lapsedEnd && lapsedEnd > start ? lapsedEnd : (profile === 'lapsed' ? new Date(start.getTime() + 35 * DAY) : null);
        const m = mem(start, { status: end ? 'EXPIRED' : 'ACTIVE', stripeSubscriptionId: `sub_${hex()}`, cancelAt: end ?? (profile === 'cancelling' ? DateTime.fromJSDate(start).plus({ months: Math.ceil(DateTime.now().diff(DateTime.fromJSDate(start), 'months').months) }).toJSDate() : null), cancelledById: end || profile === 'cancelling' ? payer.id : null, expiryDate: end });
        s.memberships.push({ id: m.id, start, end: end ?? m.cancelAt ?? null, credits: null });
        // First payment, then a renewal each month, for at most the last year.
        let at = DateTime.fromJSDate(start); let first = true; let n = 0;
        const stop = end ?? NOW;
        while (at.toJSDate() <= stop && n < 400) {
          if (at.toJSDate() >= daysAgo(370)) {
            const failed = !first && chance(0.025);
            if (failed) {
              tx(m, at.toJSDate(), money(plan), 'RENEWAL', 'FAILED', { method: 'STRIPE' });
              tx(m, at.plus({ days: 3 }).toJSDate(), money(plan), 'RENEWAL', 'SUCCESSFUL', { method: 'STRIPE' });
            } else tx(m, at.toJSDate(), money(plan), first ? 'MEMBERSHIP' : 'RENEWAL', 'SUCCESSFUL', { method: 'STRIPE' });
          }
          first = false; n++; at = at.plus({ months: 1 });
        }
      } else if (plan.type === 'WEEKLY_PASS') {
        // Brazil: a 30-day pass bought each month, by Pix or cash at the desk.
        const lapsed = profile === 'lapsed';
        const lastEnd = lapsed ? daysAgo(between(10, 80)) : null;
        let start = DateTime.fromJSDate(new Date(Math.max(s.joined.getTime(), daysAgo(150).getTime())));
        while (true) {
          const end = start.plus({ days: 30 });
          const current = end.toJSDate() > NOW;
          if (lapsed && end.toJSDate() > lastEnd) break;
          const m = mem(start.toJSDate(), { status: current ? 'ACTIVE' : 'EXPIRED', expiryDate: end.toJSDate() });
          s.memberships.push({ id: m.id, start: start.toJSDate(), end: end.toJSDate(), credits: null });
          tx(m, start.toJSDate(), money(plan), 'MEMBERSHIP', 'SUCCESSFUL');
          if (current) break;
          start = end.plus({ hours: between(0, 30) });
        }
        if (!s.memberships.length && lapsed) {
          const st0 = DateTime.fromJSDate(daysAgo(between(60, 120)));
          const m = mem(st0.toJSDate(), { status: 'EXPIRED', expiryDate: st0.plus({ days: 30 }).toJSDate() });
          s.memberships.push({ id: m.id, start: st0.toJSDate(), end: st0.plus({ days: 30 }).toJSDate(), credits: null });
          tx(m, st0.toJSDate(), money(plan), 'MEMBERSHIP', 'SUCCESSFUL');
        }
      } else if (plan.type === 'CLASS_PACK') {
        const start = new Date(Math.max(s.joined.getTime(), daysAgo(between(5, plan.expiryDurationDays - 5)).getTime()));
        const m = mem(start, { status: 'ACTIVE', classesRemaining: plan.classesIncluded, expiryDate: new Date(start.getTime() + plan.expiryDurationDays * DAY) });
        s.memberships.push({ id: m.id, start, end: m.expiryDate, credits: plan.classesIncluded, row: m });
        tx(m, start, money(plan), 'MEMBERSHIP', 'SUCCESSFUL');
        // Earlier, an expired starter pack or trial, so the history isn't empty.
        if (s.joined < start) {
          const p0 = new Date(Math.max(s.joined.getTime(), start.getTime() - 100 * DAY));
          const m0 = mem(p0, { membershipPlanId: plan.id, status: 'EXPIRED', classesRemaining: 0, expiryDate: new Date(p0.getTime() + plan.expiryDurationDays * DAY) });
          s.memberships.unshift({ id: m0.id, start: p0, end: new Date(Math.min(m0.expiryDate.getTime(), start.getTime())), credits: plan.classesIncluded, row: m0 });
          tx(m0, p0, money(plan), 'MEMBERSHIP', 'SUCCESSFUL');
        }
      } else if (plan.type === 'TRIAL_MEMBERSHIP') {
        const start = s.joined;
        const m = mem(start, { status: 'ACTIVE', expiryDate: new Date(start.getTime() + 7 * DAY) });
        s.memberships.push({ id: m.id, start, end: m.expiryDate, credits: null });
      }
      // A freeze in progress (approved by the owner).
      if (profile === 'frozen') {
        const m = s.memberships[s.memberships.length - 1];
        const startsAt = daysAgo(between(3, 12)); const endsAt = new Date(startsAt.getTime() + between(21, 35) * DAY);
        freezes.push({ id: randomUUID(), membershipId: m.id, schoolId: S.id, studentId: s.user.id, startsAt: dateOnly(localDay(zone, startsAt)), endsAt: dateOnly(localDay(zone, endsAt)), status: 'APPROVED', requestedById: s.user.id, decidedById: ctx.owner.id, decidedAt: new Date(startsAt.getTime() - 2 * DAY), createdAt: new Date(startsAt.getTime() - 3 * DAY), updatedAt: new Date(startsAt.getTime() - 2 * DAY) });
        s.frozenFrom = startsAt;
      }
    }

    // A few members asked to pay by Pix / cash and are waiting for the School to confirm.
    const pendingFor = shuffle(ctx.students.filter((s) => s.profile === 'lapsed')).slice(0, cardSchool ? 3 : 6);
    for (const s of pendingFor) {
      const plan = s.isKid ? ctx.plans.kids : (cardSchool ? ctx.plans.pack10 : ctx.plans.unlimited);
      const at = new Date(NOW.getTime() - between(2, 40) * 3600e3);
      transactions.push({ id: randomUUID(), schoolId: S.id, studentId: s.user.id, paymentAccountId: pa.id, membershipPlanId: plan.id, kind: 'MEMBERSHIP', billingDate: at, amount: plan.price, currency: S.currency, status: 'PENDING', paymentMethod: cardSchool ? 'CASH' : 'PIX', createdAt: at, updatedAt: at });
      st.transactions++;
    }

    // Two card packs refunded in full by the owner (the pack ended with it).
    const packIds = new Set(memberships.filter((m) => m.schoolId === S.id && m.status === 'EXPIRED' && m.membershipPlanId === ctx.plans.pack10.id).map((m) => m.id));
    for (const t of transactions.filter((t) => packIds.has(t.membershipId) && t.paymentMethod === 'STRIPE').slice(0, 2)) { t.status = 'REFUNDED'; t.refundedAmount = t.amount; t.updatedAt = new Date(t.billingDate.getTime() + 2 * DAY); }

    // ---- Attendance: each member trains a few times a week in their branch's
    // classes for their program, while a membership covered them.
    const classesByBranchProgram = new Map();
    for (const c of classes) {
      if (!c.slot) continue;
      const key = `${c.branchId}|${c.slot.disc}`;
      if (!classesByBranchProgram.has(key)) classesByBranchProgram.set(key, []);
      classesByBranchProgram.get(key).push(c);
    }
    const checkInMethods = [['SELF_SERVICE', 45], ['PERSONAL_CODE', 25], ['INSTRUCTOR_SCAN', 15], ['INSTRUCTOR_MANUAL', 10], ['SELF_SERVICE_CODE', 5]];
    for (const s of ctx.students) {
      const pool = classesByBranchProgram.get(`${s.branch.id}|${s.isKid ? 'kids' : 'adult'}`) ?? [];
      const female = s.user.gender === 'FEMALE';
      const perWeek = s.named === 'member' ? 3 : s.isKid ? weighted([[1, 30], [2, 50], [3, 20]]) : weighted([[1, 22], [2, 38], [3, 27], [4, 13]]);
      s.perWeek = perWeek;
      const favourites = shuffle(pool.filter((c) => c.audience !== 'WOMEN' || female).map((c) => c.slot.id)).filter((v, i, a) => a.indexOf(v) === i).slice(0, perWeek + 2);
      const byWeek = new Map();
      for (const c of pool) {
        if (!favourites.includes(c.slot.id)) continue;
        if (!byWeek.has(c.week)) byWeek.set(c.week, []);
        byWeek.get(c.week).push(c);
      }
      s.bookings = [];
      for (const [, weekClasses] of byWeek) {
        const chosen = shuffle(weekClasses.slice()).slice(0, perWeek).sort((a, b) => a.startDate - b.startDate);
        for (const c of chosen) {
          const m = s.memberships.find((x) => c.startDate >= x.start && (!x.end || c.startDate < x.end));
          if (!m) continue;
          if (c.startDate < histStart) continue;
          if (s.frozenFrom && c.startDate >= s.frozenFrom) continue;
          if (c.startDate > new Date(NOW.getTime() + 7 * DAY)) continue;
          if (c.capacity && c.count >= c.capacity) continue;
          if (m.credits !== null && m.credits !== undefined) { if (m.credits <= 0) continue; }
          const past = c.endDate < NOW; const started = c.startDate < NOW;
          if (!past && !started && !chance(0.55)) continue; // not everyone books ahead
          let status = 'UPCOMING';
          if (past || started) status = weighted([['COMPLETED', 90], ['NO_SHOW', 3], ['CANCELLED', 7]]);
          if (started && !past && status === 'NO_SHOW') status = 'UPCOMING';
          if (s.named === 'fresh' && past) status = 'COMPLETED';
          const bookedAt = new Date(c.startDate.getTime() - between(2, 72) * 3600e3);
          const b = { id: randomUUID(), studentId: s.user.id, classId: c.id, schoolId: S.id, branchId: c.branchId, status, sourceMembershipId: m.id, creditUsed: status !== 'CANCELLED', createdAt: bookedAt, updatedAt: status === 'UPCOMING' ? bookedAt : c.startDate };
          if (status === 'CANCELLED') b.updatedAt = new Date(c.startDate.getTime() - between(3, 20) * 3600e3);
          if (m.credits !== null && m.credits !== undefined && status !== 'CANCELLED') m.credits--;
          if (status === 'COMPLETED') {
            b.checkInMethod = s.isKid ? weighted([['PERSONAL_CODE', 40], ['INSTRUCTOR_MANUAL', 35], ['INSTRUCTOR_SCAN', 25]]) : weighted(checkInMethods);
            b.checkedInById = ['INSTRUCTOR_SCAN', 'INSTRUCTOR_MANUAL'].includes(b.checkInMethod) ? c.instructorId : s.user.id;
            st.checkIns++;
            trainingLogs.push({ id: randomUUID(), schoolId: S.id, studentId: s.user.id, disciplineId: ctx.disc[c.slot.disc], minutes: Math.round((c.endDate - c.startDate) / 60000), source: 'CHECK_IN', classId: c.id, bookingId: b.id, trainedAt: c.startDate, createdAt: c.startDate });
          }
          if (status === 'UPCOMING') st.upcomingBookings++;
          if (status !== 'CANCELLED') c.count++;
          bookings.push(b); s.bookings.push({ ...b, cls: c }); st.bookings++;
        }
      }
      // Class packs: what's left after the classes they booked.
      for (const m of s.memberships) if (m.row && m.credits !== null) m.row.classesRemaining = Math.max(0, m.credits);
    }

    // ---- Ranks: one per member in their program, with a grading history.
    const disciplineOf = (s) => (s.isKid ? 'kids' : 'adult');
    const coachesForGrading = ctx.coaches;
    for (const s of ctx.students) {
      const ladder = ctx.ladder[disciplineOf(s)];
      const belts = [...new Set(ladder.map((r) => r.rankName))];
      const yearsTraining = (NOW - s.joined) / (365.25 * DAY);
      let beltIdx;
      if (s.isKid) {
        const age = (NOW - s.user.dateOfBirth) / (365.25 * DAY);
        const maxBelt = Math.min(belts.length - 1, Math.floor(age / 2.2), Math.floor(yearsTraining * 1.4 + rand() * 1.5));
        beltIdx = Math.max(0, Math.min(maxBelt, between(0, maxBelt)));
      } else {
        const transfer = chance(0.15) ? between(1, 3) : 0; // trained elsewhere before
        const maxBelt = Math.min(3, Math.floor(yearsTraining / 2.2) + transfer);
        beltIdx = Math.max(0, Math.min(maxBelt, weighted([[0, 50], [1, 30], [2, 13], [3, 7]])));
      }
      if (s.named === 'member') beltIdx = 1;
      if (s.named === 'fresh') beltIdx = 0;
      const beltRungs = ladder.filter((r) => r.rankName === belts[beltIdx]);
      let rung = s.named === 'fresh' ? beltRungs[0] : pick(beltRungs.slice(0, Math.min(beltRungs.length, 5)));
      if (s.named === 'member') rung = beltRungs[Math.min(3, beltRungs.length - 1)];
      const idx = ladder.indexOf(rung);
      const next = ladder[idx + 1];
      // How far along to the next rung: most are on their way, some are ready.
      const target = s.named === 'member' ? 1.05 : s.named === 'fresh' ? 0 : weighted([[0.12, 30], [0.45, 38], [0.75, 20], [1.1, 12]]) * (0.85 + rand() * 0.3);
      const required = next?.classesRequired ?? 0;
      const weekly = Math.max(0.5, Math.min(s.perWeek ?? 2, next?.cap ?? 9) * 0.85);
      let rankDays = required ? Math.round(((target * required) / weekly) * 7) : between(30, 400);
      if (target >= 1 && next) rankDays = Math.max(rankDays, next.minDays + between(3, 40));
      rankDays = Math.max(1, Math.min(rankDays, Math.floor((NOW - s.joined) / DAY)));
      if (s.named === 'fresh') rankDays = Math.max(1, Math.floor((NOW - s.joined) / DAY));
      const rankDate = daysAgo(rankDays);
      // Classes counted toward the next rung: those since the rank date, of a
      // type the next rung counts, within its weekly cap; before the history
      // window, at the member's usual rate.
      let counted = 0; const byType = {};
      if (next && !next.timeOnly) {
        const perWeekCount = new Map();
        for (const b of s.bookings) {
          if (b.status !== 'COMPLETED' || b.cls.startDate < rankDate) continue;
          const type = b.cls.slot.type;
          if (next.eligible.length && !next.eligible.includes(type)) continue;
          const wk = b.cls.week; const n = perWeekCount.get(wk) ?? 0;
          if (next.cap && n >= next.cap) continue;
          perWeekCount.set(wk, n + 1); counted++; byType[type] = (byType[type] ?? 0) + 1;
        }
        if (rankDate < histStart) {
          const before = Math.round(((histStart - rankDate) / (7 * DAY)) * weekly * 0.9);
          counted += before;
        }
        if (s.named === 'member') counted = Math.max(counted, required + 2);
      }
      const verified = !(s.joined > daysAgo(20) && beltIdx > 0 && chance(0.6));
      const srId = randomUUID();
      const grader = s.isKid ? (ctx.coaches.find((c) => c.kids && c.branchId === s.branch.id) ?? ctx.coaches.find((c) => c.head)).user : (ctx.coaches.find((c) => c.head && c.branchId === s.branch.id) ?? ctx.coaches.find((c) => c.head)).user;
      studentRanks.push({ id: srId, studentId: s.user.id, disciplineId: ctx.disc[disciplineOf(s)], schoolId: S.id, currentRankId: rung.rankId, currentStripeId: rung.tierId, dateOfCurrentRank: rankDate, countingSince: rankDate, classesAttendedTowardCheckpoint: counted, classesAttendedByType: {}, verificationStatus: verified ? 'VERIFIED' : 'UNVERIFIED', verifiedAt: verified ? new Date(Math.max(s.joined.getTime(), rankDate.getTime())) : null, verifiedById: verified ? ctx.owner.id : null, createdAt: s.joined, updatedAt: NOW });
      s.rank = { rung, next, counted, srId };
      // History: the steps that led here since joining, newest first.
      if (!verified) {
        events.push({ id: randomUUID(), studentRankId: srId, schoolId: S.id, studentId: s.user.id, type: 'SELF_DECLARED', performedById: s.isKid ? s.guardian.id : s.user.id, toRankId: rung.rankId, toStripeTierId: rung.tierId, effectiveDate: rankDate, systemNote: 'Rank declared when joining; waiting for the School to verify it.', createdAt: rankDate });
        continue;
      }
      let at = rankDate; let k = idx; let steps = 0;
      while (k > 0 && at > s.joined && steps < 6) {
        const prev = ladder[k - 1]; const cur = ladder[k];
        const beltChange = prev.rankId !== cur.rankId;
        events.push({ id: randomUUID(), studentRankId: srId, schoolId: S.id, studentId: s.user.id, type: beltChange ? 'PROMOTION' : (chance(0.3) ? 'BULK_STRIPE_AWARD' : 'STRIPE_AWARD'), performedById: beltChange ? headCoach.id : grader.id,
          fromRankId: prev.rankId, toRankId: cur.rankId, fromStripeTierId: prev.tierId, toStripeTierId: cur.tierId, effectiveDate: at,
          note: beltChange && chance(0.6) ? pick(['Well deserved, great progress this year.', 'Excellent technique and attitude on the mat.', 'Promoted at the grading day.', 'Congratulations!']) : null, createdAt: at });
        at = new Date(at.getTime() - Math.max(cur.minDays, 20) * (1 + rand() * 0.8) * DAY);
        k--; steps++;
      }
    }

    // Coaches' own belts (verified by the owner) and their grading permissions.
    for (const c of ctx.coaches) {
      const ladder = ctx.ladder.adult;
      const rung = ladder.find((r) => r.rankName === c.belt[0] && r.stripes === c.belt[1]) ?? ladder.filter((r) => r.rankName === c.belt[0])[0] ?? ladder[ladder.length - 1];
      instructorBelts.push({ id: randomUUID(), schoolId: S.id, userId: c.user.id, disciplineId: ctx.disc.adult, rankId: rung.rankId, stripeTierId: rung.tierId, verificationStatus: 'VERIFIED', verifiedAt: c.at, verifiedById: ctx.owner.id, declaredAt: c.at });
      const assistant = /Purple/.test(c.belt[0]);
      for (const d of ['adult', 'kids']) {
        if (d === 'adult' && c.kids && !c.head && assistant) continue;
        gradingPerms.push({ id: randomUUID(), schoolId: S.id, userId: c.user.id, disciplineId: ctx.disc[d], grantedById: ctx.owner.id,
          canPromote: !assistant || d === 'kids', canDowngrade: c.head, canSignOffSkills: true, canAdjustProgress: !assistant, canVerifyRanks: c.head || !assistant, canVoidHistory: c.head, canChangeBoardThresholds: c.head, createdAt: c.at });
      }
    }

    // Waivers: almost everyone has signed (a parent for a child).
    for (const s of ctx.students) {
      if (s.named === 'fresh') continue; // signs in the app as part of the demo
      if (!s.named && chance(0.06)) continue; // a few still to sign
      const signer = s.isKid ? s.guardian : s.user;
      const at = new Date(s.joined.getTime() + between(0, 3) * 3600e3);
      const name = `${signer.firstName} ${signer.surname}`;
      signatures.push({ id: randomUUID(), waiverId: ctx.waiver.id, studentId: s.user.id, signedById: signer.id, schoolId: S.id, signerFullName: name, signatureText: name, signedDate: at, status: 'SIGNED',
        signedWaiverTitle: ctx.waiver.title, signedWaiverBody: ctx.waiver.body, signedWaiverSha256: sha256(ctx.waiver.body), signedWaiverVersion: ctx.waiver.version, method: !s.named && chance(0.08) ? 'PAPER' : 'ONLINE',
        recordedById: null, signedViaGuardianId: s.isKid ? s.guardian.id : null, createdAt: at, updatedAt: at });
    }

    // Notifications: the owner's and coaches' inbox, and the members'.
    const ready = ctx.students.filter((s) => s.rank.next && !s.rank.next.timeOnly && s.rank.counted >= s.rank.next.classesRequired).slice(0, 12);
    const note = (userId, title, body, type, hoursAgo, extra = {}) => notifications.push({ id: randomUUID(), userId, title, body, type, schoolId: S.id, schoolName: S.name, read: hoursAgo > 30 && chance(0.7), createdAt: new Date(NOW.getTime() - hoursAgo * 3600e3), ...extra });
    const pt = S.language === 'pt-BR';
    for (const [i, s] of ready.entries()) {
      const who = `${s.user.firstName} ${s.user.surname}`;
      note(ctx.owner.id, pt ? 'Pronto para graduar' : 'Ready to grade', pt ? `${who} cumpriu os requisitos para ${s.rank.next.name}.` : `${who} has met the requirements for ${s.rank.next.name}.`, 'GRADING_READY', 2 + i * 9, { targetType: 'STUDENT', targetId: s.user.id });
      const coach = ctx.coaches.find((c) => c.branchId === s.branch.id && c.head) ?? ctx.coaches[0];
      note(coach.user.id, pt ? 'Pronto para graduar' : 'Ready to grade', pt ? `${who} cumpriu os requisitos para ${s.rank.next.name}.` : `${who} has met the requirements for ${s.rank.next.name}.`, 'GRADING_READY', 2 + i * 9, { targetType: 'STUDENT', targetId: s.user.id });
    }
    for (const s of pendingFor) note(ctx.owner.id, pt ? 'Pagamento para confirmar' : 'Payment to confirm', pt ? `${s.user.firstName} ${s.user.surname} escolheu pagar por Pix ou em dinheiro.` : `${s.user.firstName} ${s.user.surname} chose to pay in cash. Confirm it once you have the money.`, 'CASH_PAYMENT', between(2, 40));
    for (const s of ctx.students.filter((x) => x.profile === 'lapsed').slice(0, 5)) note(ctx.owner.id, pt ? 'Plano encerrado' : 'Membership ended', pt ? `O plano de ${s.user.firstName} ${s.user.surname} terminou.` : `${s.user.firstName} ${s.user.surname}'s membership has ended.`, 'MEMBERSHIP_EXPIRY', between(20, 300));
    for (const s of ctx.students.filter((x) => x.profile === 'frozen')) note(ctx.owner.id, pt ? 'Plano congelado' : 'Membership frozen', pt ? `O plano de ${s.user.firstName} ${s.user.surname} está congelado.` : `${s.user.firstName} ${s.user.surname}'s membership is frozen.`, 'MEMBERSHIP_FREEZE', between(30, 200));
    for (const s of ctx.students.filter((x) => x.named === 'member' || x.named === 'aluno' || x.named === 'child')) {
      const to = s.isKid ? s.guardian.id : s.user.id;
      const last = events.filter((e) => e.studentId === s.user.id && e.type !== 'SELF_DECLARED').sort((a, b) => b.effectiveDate - a.effectiveDate)[0];
      if (last) note(to, pt ? 'Você foi graduado!' : s.isKid ? `${s.user.firstName} has been promoted!` : "You've been promoted!", pt ? 'Parabéns pela nova graduação.' : 'Congratulations on your new rank.', 'GRADING_RANK_CHANGE', Math.max(1, (NOW - last.effectiveDate) / 3600e3));
      note(to, pt ? 'Seminário no sábado' : 'Seminar this Saturday', pt ? 'Seminário de passagem de guarda com o professor Marcelo. Inscrições na recepção.' : 'Guard-passing seminar with Rafael this Saturday after the open mat. Sign up at the front desk.', 'SCHOOL_BROADCAST', 20);
      note(to, pt ? 'Feriado: horário especial' : 'Bank holiday timetable', pt ? 'Na próxima segunda o treino da noite começa às 18h.' : 'Next Monday the evening classes start at 6pm.', 'SCHOOL_BROADCAST', 70);
    }
    for (const c of ctx.coaches) note(c.user.id, pt ? 'Novo horário publicado' : 'New timetable published', pt ? 'O horário de dezembro já está no app.' : "December's timetable is live in the app.", 'SCHOOL_BROADCAST', 50);
    note(founder.id, `${S.name}`, `${st.activeMemberships} active memberships this month.`, 'SCHOOL_BROADCAST', 6 + world.indexOf(ctx) * 5);

    // Leads: visitors and new members waiting at the sign-up list.
    const nm = NAMES[S.names];
    const sources = S.language === 'pt-BR' ? ['Instagram', 'Google', 'Indicação de amigo', 'Passei na frente'] : ['Instagram', 'Google', 'A friend', 'Walked past'];
    const signUps = [];
    for (let i = 0; i < (ctx.S.main ? 9 : 5); i++) {
      const gender = chance(0.65) ? 'MALE' : 'FEMALE'; const first = pick(gender === 'MALE' ? nm.m : nm.f); const last = pick(nm.s);
      const at = new Date(NOW.getTime() - between(3, 240) * 3600e3);
      signUps.push({ id: randomUUID(), schoolId: S.id, branchId: pick(ctx.branches).id, kind: i % 3 === 0 ? 'MEMBER' : 'VISITOR', status: i < 2 && ctx.S.main ? 'APPROVED' : 'PENDING', firstName: first, surname: last, dateOfBirth: dob(18, 40), gender, email: `${strip(first)}.${strip(last)}.lead${i}@${DOMAIN}`, phone: phoneFor(S.country), heardFrom: pick(sources), approvedById: i < 2 && ctx.S.main ? ctx.staff[0].user.id : null, approvedAt: i < 2 && ctx.S.main ? at : null, createdAt: at, updatedAt: at });
    }
    await db.signUp.createMany({ data: signUps });
    log(`${S.name}: ${ctx.students.length} members, ${st.bookings} bookings (${st.checkIns} check-ins)`);
  }

  // ---- Curriculum, tags, notes, franchise fees.
  const skillRows = []; const catRows = []; const lessonRows = []; const lessonContent = []; const lessonSkills = [];
  const tagRows = []; const studentTags = []; const noteRows = [];
  const SKILLS = {
    en: { adult: ['Closed guard retention', 'Scissor sweep', 'Hip bump sweep', 'Armbar from guard', 'Triangle choke', 'Knee-cut pass', 'Torreando pass', 'Mount escape (trap and roll)', 'Side control escape', 'Rear naked choke', 'Double-leg takedown', 'Back take from turtle'],
          kids: ['Breakfall', 'Shrimp', 'Technical stand-up', 'Bridge and roll', 'Guard pull', 'Scissor sweep', 'Mount control', 'Armbar from mount'],
          cats: { Fundamentals: [0, 3, 7, 8], Guard: [1, 2, 4], Passing: [5, 6], 'Back attacks': [9, 11] } },
    pt: { adult: ['Manutenção da guarda fechada', 'Raspagem de tesoura', 'Raspagem de quadril', 'Chave de braço da guarda', 'Triângulo', 'Passagem joelho na barriga', 'Passagem toureando', 'Fuga da montada (upa)', 'Fuga dos 100 kg', 'Mata-leão', 'Baiana', 'Pegada das costas'],
          kids: ['Rolamento', 'Fuga de quadril', 'Levantada técnica', 'Upa', 'Puxada para a guarda', 'Raspagem de tesoura', 'Controle da montada', 'Chave de braço da montada'],
          cats: { Fundamentos: [0, 3, 7, 8], Guarda: [1, 2, 4], 'Passagem de guarda': [5, 6], Costas: [9, 11] } },
  };
  const TAGS = { en: ['Competition team', 'Instagram lead', 'Needs a gi', 'Morning crew', 'Injured – light training'], pt: ['Equipe de competição', 'Veio pelo Instagram', 'Precisa de kimono', 'Turma da manhã', 'Lesionado – treino leve'] };
  const NOTES = { en: ['Prefers the lunchtime classes.', 'Recovering from a knee injury – no takedowns for now.', 'Interested in competing at the next regional open.', 'Paid for a gi, collect at the front desk.', 'Brother also wants to try the kids class.'], pt: ['Prefere os treinos do almoço.', 'Recuperando do joelho – sem quedas por enquanto.', 'Quer competir no próximo open.', 'Kimono pago, retirar na recepção.', 'O irmão quer experimentar o kids.'] };
  for (const ctx of world) {
    const L = ctx.S.language === 'pt-BR' ? 'pt' : 'en';
    const set = SKILLS[L];
    const skillIds = { adult: [], kids: [] };
    for (const d of ['adult', 'kids']) set[d].forEach((name, i) => { const id = randomUUID(); skillIds[d].push(id); skillRows.push({ id, disciplineId: ctx.disc[d], schoolId: ctx.S.id, name, order: i, createdAt: ctx.opened, updatedAt: ctx.opened }); });
    let co = 0;
    for (const [cat, idxs] of Object.entries(set.cats)) {
      const catId = randomUUID(); catRows.push({ id: catId, schoolId: ctx.S.id, name: cat, order: co++, createdAt: ctx.opened, updatedAt: ctx.opened });
      idxs.forEach((i, k) => {
        const id = randomUUID(); const coach = ctx.coaches.find((c) => c.head) ?? ctx.coaches[0];
        lessonRows.push({ id, schoolId: ctx.S.id, instructorId: coach.user.id, title: set.adult[i], categoryId: catId, order: k, free: k === 0, durationSeconds: between(240, 720), format: 'PRERECORDED', captionStatus: 'PENDING', createdAt: daysAgo(between(20, 300)), updatedAt: daysAgo(10) });
        lessonContent.push({ lessonId: id, description: L === 'pt' ? `Passo a passo: ${set.adult[i].toLowerCase()}, com os detalhes que mais aparecem nos treinos.` : `Step by step: ${set.adult[i].toLowerCase()}, with the details that come up most in class.` });
        lessonSkills.push({ lessonId: id, skillId: skillIds.adult[i] });
      });
    }
    const tagIds = TAGS[L].map((name) => { const id = randomUUID(); tagRows.push({ id, schoolId: ctx.S.id, name, createdAt: ctx.opened }); return id; });
    for (const s of ctx.students) {
      if (!s.isKid && chance(0.12)) studentTags.push({ tagId: pick(tagIds), schoolId: ctx.S.id, studentId: s.user.id, createdAt: s.joined });
      if (chance(0.06)) noteRows.push({ id: randomUUID(), schoolId: ctx.S.id, studentId: s.user.id, authorId: pick([ctx.owner, ...ctx.coaches.map((c) => c.user)]).id, body: pick(NOTES[L]), showToMember: false, createdAt: daysAgo(between(1, 90)) });
    }
  }
  // The Franchise's own Stripe account and a flat monthly fee from each member
  // School (Spec §2: a separate payment relationship, ULTM8 takes no cut).
  const franchiseAccount = await db.paymentAccount.create({ data: { id: randomUUID(), franchiseId: FRANCHISE_ID, provider: 'STRIPE', accountTitle: 'Apex Jiu-Jitsu (franchise)', country: 'GB', status: 'ACTIVE', mode: 'TEST', stripeConnectedAccountId: `acct_${hex(8)}`, stripeAccountReady: true, stripeAccountReadyCheckedAt: daysAgo(2) } });
  await db.franchise.update({ where: { id: FRANCHISE_ID }, data: { feeModel: 'FLAT', flatFeeAmount: 25000 } });
  const feeRows = [];
  for (const ctx of world) {
    const sub = `sub_${hex()}`;
    await db.school.update({ where: { id: ctx.S.id }, data: { stripeFranchiseFeeSubscriptionId: sub, stripeFranchiseFeeCustomerId: `cus_${hex()}`, franchiseFeeSubscriptionStatus: 'ACTIVE' } });
    if (ctx.S.main) continue;
    for (let m = 6; m >= 1; m--) {
      const start = DateTime.now().minus({ months: m }).startOf('month'); const end = start.plus({ months: 1 });
      if (start.toJSDate() < ctx.opened) continue;
      feeRows.push({ id: randomUUID(), franchiseId: FRANCHISE_ID, schoolId: ctx.S.id, franchisePaymentAccountId: franchiseAccount.id, billingPeriodStart: start.toJSDate(), billingPeriodEnd: end.toJSDate(), feeBasisSnapshot: 'FLAT', amount: 25000, currency: 'USD', status: 'SUCCESSFUL', stripeInvoiceId: `in_${hex()}`, stripeSubscriptionId: sub, stripePaymentIntentId: `pi_${hex()}`, createdAt: end.plus({ hours: 2 }).toJSDate(), updatedAt: end.plus({ hours: 2 }).toJSDate() });
    }
  }

  log(`inserting ${memberships.length} memberships, ${transactions.length} payments, ${bookings.length} bookings, ${events.length} grading entries`);
  await chunked(memberships, (rows) => db.membership.createMany({ data: rows }));
  await chunked(transactions, (rows) => db.transaction.createMany({ data: rows }));
  await chunked(freezes, (rows) => db.membershipFreeze.createMany({ data: rows }));
  await chunked(bookings, (rows) => db.booking.createMany({ data: rows }));
  await chunked(trainingLogs, (rows) => db.trainingLog.createMany({ data: rows }));
  await chunked(studentRanks, (rows) => db.studentRank.createMany({ data: rows }));
  await chunked(events, (rows) => db.promotionEvent.createMany({ data: rows }));
  await chunked(instructorBelts, (rows) => db.instructorBelt.createMany({ data: rows }));
  await chunked(gradingPerms, (rows) => db.gradingPermission.createMany({ data: rows }));
  // Publishing the waiver made an Unsigned row for every member; a signed one replaces it.
  await chunked(signatures, async (rows) => {
    await db.waiverSignature.deleteMany({ where: { status: 'UNSIGNED', OR: rows.map((r) => ({ waiverId: r.waiverId, studentId: r.studentId })) } });
    await db.waiverSignature.createMany({ data: rows });
  }, 500);
  await chunked(notifications, (rows) => db.notification.createMany({ data: rows }));
  await db.skill.createMany({ data: skillRows });
  await db.lessonCategory.createMany({ data: catRows });
  await db.lesson.createMany({ data: lessonRows });
  await db.lessonContent.createMany({ data: lessonContent });
  await db.lessonSkill.createMany({ data: lessonSkills });
  await db.schoolTag.createMany({ data: tagRows });
  await db.studentTag.createMany({ data: studentTags, skipDuplicates: true });
  await db.studentNote.createMany({ data: noteRows });
  await db.franchiseFeeCharge.createMany({ data: feeRows });
  // Payroll: coaches paid per class or by the hour (the owner's Rates tab).
  const rate = { GBP: [3500, 2500], EUR: [3500, 2500], BRL: [9000, 6000] };
  await db.staffPayRate.createMany({ data: world.flatMap((ctx) => ctx.coaches.map((c) => {
    const [perClass, hourly] = rate[ctx.S.currency];
    return c.head || chance(0.5) ? { id: randomUUID(), schoolId: ctx.S.id, userId: c.user.id, perClassRate: c.head ? perClass + 1500 : perClass, updatedById: ctx.owner.id } : { id: randomUUID(), schoolId: ctx.S.id, userId: c.user.id, hourlyRate: hourly, updatedById: ctx.owner.id };
  })) });
  // Publishing the waiver asked every member (or their parent) to sign it;
  // keep that notice only for those who still haven't.
  const signedStudents = new Set(signatures.map((r) => r.studentId));
  const stillToSign = new Set();
  for (const ctx of world) for (const s of ctx.students) if (!signedStudents.has(s.user.id)) stillToSign.add(s.isKid ? s.guardian.id : s.user.id);
  await db.notification.deleteMany({ where: { type: 'WAIVER_SIGNATURE_REQUEST', schoolId: { in: world.map((c) => c.S.id) }, userId: { notIn: [...stillToSign] } } });

  console.table(stats);
  for (const ctx of world) {
    const sch = await db.school.findUnique({ where: { id: ctx.S.id }, select: { joinCode: true } });
    console.log(`${ctx.S.name}: join code ${sch.joinCode}, owner ${ctx.owner.email}, coach ${ctx.coaches[0].user.email}${ctx.staff[0] ? `, front desk ${ctx.staff[0].user.email}` : ''}`);
  }
  console.log(`Franchise owner ${founder.email}; members ${['member', 'parent', 'new.member', 'aluno'].map((e) => `${e}@${DOMAIN}`).join(', ')}; passcode ${process.env.DEMO_PASSCODE ? '(DEMO_PASSCODE)' : PASSCODE}`);
  log('done');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
