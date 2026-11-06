// The two rehearsal Schools. Amounts are in hundredths (the app stores every
// amount that way, whatever the currency).
export const SCHOOLS = [
  {
    key: 'A',
    label: 'School A (UK)',
    country: 'GB',
    name: 'Rehearsal Dojo London',
    timezone: 'Europe/London',
    currency: 'GBP',
    language: 'en-GB',
    address: { line1: '12 Market Street', city: 'London', postalCode: 'E1 6AN', country: 'GB' },
    branch: 'Shoreditch',
    provider: 'STRIPE',
    cards: true,
    plans: { pack: '10-class pack', next: '5-class pack', week: 'Intro week', kids: 'Kids 8-class pack', sub: 'Unlimited monthly' },
    names: { owner: ['Olivia', 'Hart'], staff: ['Sam', 'Patel'], adult: ['James', 'Wright'], parent: ['Emma', 'Clarke'], child: ['Lily', 'Clarke'], lonely: ['Mark', 'Evans'], lonelyKid: ['Toby', 'Evans'], extra: ['Ava', 'Brown'] },
  },
  {
    key: 'B',
    label: 'School B (Brazil)',
    country: 'BR',
    name: 'Academia Ensaio São Paulo',
    timezone: 'America/Sao_Paulo',
    currency: 'BRL',
    language: 'pt-BR',
    address: { line1: 'Rua Augusta, 1500', city: 'São Paulo', region: 'SP', postalCode: '01304-001', country: 'BR' },
    branch: 'Consolação',
    provider: 'BANK_TRANSFER',
    cards: false,
    plans: { pack: 'Pacote 10 aulas', next: 'Pacote 5 aulas', week: 'Semana experimental', kids: 'Kids 8 aulas', sub: 'Mensal ilimitado' },
    names: { owner: ['João', 'Silva'], staff: ['Mariana', 'Costa'], adult: ['Lucas', 'Oliveira'], parent: ['Ana', 'Souza'], child: ['Beatriz', 'Souza'], lonely: ['Pedro', 'Lima'], lonelyKid: ['Gabriel', 'Lima'], extra: ['Camila', 'Rocha'] },
  },
];
