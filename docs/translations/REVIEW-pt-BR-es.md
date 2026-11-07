# Translation review: Brazilian Portuguese (pt-BR) and Spanish (es)

Reviewed 6 Nov 2026 against `origin/master` at `8fc68b73`. Scope: every pt-BR
and es string in

- `apps/school-portal/src/i18n/messages/` (portal, 4,259 strings),
- `apps/student/src/i18n/messages/` (student app, 973 strings),
- `packages/i18n/src/serverKeys/` (server notices and coded errors, 288 strings),
- `packages/i18n/src/server/` (API error messages, 863 strings).

That is 6,383 strings per language. English is the source. Only values were
changed: no key, placeholder (`{name}`) or plural form was touched, and the
key-completeness tests still pass. Strings added to `master` after this review
started (account deletion, the payroll setting, the plan-switch notice, the
Connect Stripe country gate) were not reviewed here; they were checked in a
follow-up pass on 6 Nov 2026 (one es change: "la nómina" for payroll in an API
message; pt-BR needed none — the "(Pix)" in its Stripe message is kept, Decision
439 item 6).

How the review was done: the high-risk areas (waivers, children's consent,
privacy and medical data, closing and deleting, contracts, early-exit fees,
refunds, tax, surcharges, member-facing payment text) and every short label
(buttons, tabs, menus, column headings: about 2,000 distinct strings) were
read in full in both languages. Every other string was checked
with term-by-term searches against the glossary below (English term → which
translations appear), plus searches for Spain-only and European-Portuguese
words, untranslated English, register (tú/usted, você/tu) and text expansion.
Long explanatory hints outside the high-risk areas were not all read line by
line; the native reviewer should still read them.

## Glossary

### Brazilian Portuguese (pt-BR)

Register: **você** throughout (no "tu" forms were found). Brazilian, not
European, Portuguese (no "ecrã", "utilizador", "registo", "equipa",
"palavra-passe" were found).

| English | pt-BR | Notes |
|---|---|---|
| belt | faixa | |
| stripe | grau (graus) | What Brazilian academies call the tape on the belt. |
| black-belt degree | grau | Same word as stripe, as in BJJ usage. |
| rank / grade (a rung) | graduação | "Graduação" is both the rank and the act of grading. |
| grading / promotion | graduação / promoção | "Promover" for promote; "Taxa de promoção" for promotion fee. |
| Ready to Grade / Getting There / Just Starting | Pronto para graduar / Progredindo / Começando | |
| ladder | escala | Was a mix of "escada" and "escala". |
| tag colour (bar on the belt) | cor da ponteira | |
| open mat | treino livre | Brazilian academies also say "open mat"; "treino livre" chosen for consistency. |
| class pack | pacote de aulas | |
| membership | plano (also "matrícula") | The draft uses "matrícula" for the membership a member holds and "Planos de matrícula" for Membership Plans. Both kept. |
| subscription | assinatura | Caution: "assinatura" also means signature. On contract and waiver screens "plano" is used for membership to avoid confusion. |
| freeze | congelamento / congelar | |
| waiver | termo de responsabilidade (short: termo) | |
| guardian / parent | responsável; "pai, mãe ou responsável" where English says "parent or guardian" | |
| check-in | check-in (fazer check-in) | |
| front desk | recepção | Was a mix with "balcão". |
| School / Branch / Franchise | escola / unidade / franquia | Branch was mostly "filial"; Brazilian multi-location academies say "unidade", now used everywhere. |
| coach | professor | "Professor" is what Brazilian academies call the coach. |
| Instructor (the role and the page) | instrutor | English uses both words for the same role; the translation follows English. |
| Branch Staff | equipe da unidade | |
| sign-up | cadastro (cadastrar-se) | |
| waiting list / waitlist | lista de espera | |
| joining fee | taxa de matrícula | |
| early-exit fee | multa por saída antecipada | See the high-risk list. |
| late fee | multa por atraso | |
| card surcharge | acréscimo no cartão | Was a mix with "taxa de cartão". |
| waive (a fee) | dispensar | Was a mix with "isentar". |
| passcode | código de acesso | Was a mix with "senha"; the login text says there is no separate password, so "senha" contradicted it. |
| Friend Pass / Visit pass | passe de convidado / passe de visitante | Friend Pass was sometimes "passe de amigo". |
| membership card | carteirinha | |
| style / Discipline | estilo / modalidade | English has two words for the same thing; "modalidade" is the natural Brazilian word for both and a reviewer may want to unify. |
| skill | habilidade | |
| Erased User | Usuário apagado | No string uses this yet; proposed for the account-deletion work. |

### Spanish (es), neutral Latin American

Register: **tú** throughout, as consumer apps in Latin America use; plural
"you" is **ustedes** (two Spain-only "vosotros" forms were fixed). Argentina,
Uruguay and parts of Central America use "vos"; "tú" is understood there.

| English | es (Latin America) | Spain differs? |
|---|---|---|
| belt | cinturón | Some countries also say "cinta" or "faja". |
| stripe | franja | Many BJJ gyms also say "grado" for a stripe; "grado" is kept for rank here, so stripe is "franja". |
| black-belt degree | grado | |
| rank / grade (a rung) | grado | Was a mix of "grado" and "rango". |
| grading / promotion | graduación / promoción; "evaluar" for the act of grading | |
| Ready to Grade / Getting There / Just Starting | Listo para examen / En camino / Empezando | A server message said "Casi listo" / "Listo para evaluar"; now matches the board. |
| ladder | escala | Was a mix with "escalera". |
| open mat | open mat (el open mat) | The draft's "tatami libre" is rare in Latin America; gyms there say "open mat". |
| class pack | paquete de clases | Spain says "bono de clases" (the draft used it). |
| membership | membresía | Spain also says "suscripción" or "abono". |
| subscription | suscripción | |
| freeze | congelar / congelación | |
| waiver | exención (de responsabilidad) | Mexico: "carta responsiva"; Argentina: "deslinde de responsabilidad". See the high-risk list. |
| guardian / parent | tutor; "padre, madre o tutor" where English says "parent or guardian" | |
| check-in | check-in (hacer check-in) | The draft mixed in "registro" / "registrarse", which also means sign-up; now "check-in" throughout. |
| front desk | recepción | |
| School / Branch / Franchise | escuela / sede / franquicia | Branch was sometimes "sucursal" (commercial); now "sede". |
| coach | entrenador | |
| Instructor (the role and the page) | instructor | |
| Branch Staff | personal de sede | |
| sign-up | inscripción (inscribirse) | Spain also says "alta". |
| join code | código de unión | The portal said "código de acceso", the same words as the passcode. |
| waiting list / waitlist | lista de espera | |
| place / spot (on a class or plan) | lugar | Spain: "plaza" (the draft used it). |
| joining fee | cuota de inscripción | Spain: "matrícula". |
| early-exit fee | cargo por cancelación anticipada | Was "tarifa por baja anticipada". |
| late fee | recargo por retraso | Also "recargo por mora". |
| late-cancellation / no-show fee | cargo por cancelación tardía / cargo por no presentarse | |
| card surcharge | recargo por tarjeta | |
| promotion / freeze / franchise fee | cuota de promoción / cuota de congelación / cuota de franquicia | Promotion fee was sometimes "tarifa"; "tarifa" is kept for rates (payroll, franchise). |
| waive (a fee) | condonar | |
| tax rate | tasa (de impuesto) | Spain: "tipo (impositivo)". |
| tax ID | identificación fiscal | Spain: NIF. Latin America: RFC, CUIT, RUT, NIT, RUC by country. |
| amount | monto | Spain: "importe". |
| add | agregar | Spain: "añadir" (the draft used it 200+ times). |
| enter (type in) | ingresar | Spain: "introducir". |
| expired | vencido | Spain: "caducado". |
| mobile phone | celular | Spain: "móvil". |
| video | video | Spain: "vídeo". |
| take a photo | tomar una foto | Spain: "hacer una foto". |
| card terminal | terminal de tarjetas | Spain and Colombia: "datáfono". |
| quotation marks | "…" | Spain often uses «…». |
| Friend Pass / Visit pass | pase de invitado / pase de visita | Friend Pass was sometimes "pase de amigo". |
| membership card | tarjeta de socio | Also "credencial" (Mexico), "carnet" (Argentina, Chile). |
| style / Discipline | estilo / disciplina | Same two-word issue as Portuguese. |
| skill | habilidad | Was a mix with "técnica". |
| Erased User | Usuario eliminado | No string uses this yet; proposed for the account-deletion work. |

## What changed and why

Values changed: **pt-BR 288 strings**, **es 650 strings** (a string counts
once however many words in it changed).

| Area | pt-BR | es |
|---|---|---|
| School Portal (`apps/school-portal`) | 202 | 429 |
| Student app (`apps/student`) | 25 | 71 |
| Server notices and coded errors (`packages/i18n/src/serverKeys`) | 13 | 53 |
| API error messages (`packages/i18n/src/server`) | 48 | 97 |
| **Total** | **288** | **650** |

### pt-BR

- **Branch → "unidade"** everywhere (about 180 uses of "filial"/"filiais").
- **Passcode → "código de acesso"** everywhere (about 35 uses of "senha", with the
  gender agreement fixed: "um código de acesso temporário … foi enviado").
- **"assinatura" for a membership** on contract, desk-sale and receipt screens
  changed to "plano", where "assinatura" could be read as a signature, or
  where the plan cannot be a subscription (a plan sold at the desk).
- **Consistent terms:** open mat → "treino livre"; coach "treinador" →
  "professor"; promotion fee → "taxa de promoção" (some said "taxa de
  graduação"); waive → "dispensar"; card surcharge → "acréscimo no cartão";
  Friend Pass → "passe de convidado"; membership card → "carteirinha"; ladder
  → "escala"; skill → "habilidade"; front desk → "recepção"; "Getting There" →
  "Progredindo" in two places that said "quase lá".
- **School names as placeholders:** "na {school}", "A {school}", "à {school}"
  assumed a feminine name; now "em {school}", "{school}", "a {school}". "pelo
  {plan}" and "Seu {plan}" now say "pelo plano {plan}", "Seu plano {plan}".
- Smaller fixes: "Modo Criança … geridos por ela" no longer assumes the
  child's gender; "Ex-funcionário" → "Ex-equipe" like the other labels.

### es

- **Spain-only words replaced with neutral Latin American ones:** añadir →
  agregar (about 210 uses), introducir → ingresar (52), bono → paquete (37),
  plaza → lugar (32, with gender agreement), caducar → vencer (25), importe →
  monto (39), vídeo → video, móvil → celular, tipo (impositivo) → tasa, NIF →
  identificación fiscal, datáfono → terminal de tarjetas, hacer una foto →
  tomar una foto, cuenta atrás → cuenta regresiva, en directo → en vivo, a cero
  → en cero, alta → ingreso/inscripción, rellenar → completar, apuntarse →
  inscribirse, leísmo ("invitarle", "le han graduado") → "lo", two "vosotros"
  forms → "ustedes", «…» → "…".
- **Check-in** is "check-in" everywhere; the draft's "registro" /
  "registrarse" (which also means sign-up) and "registrar asistencia" are gone
  from check-in text.
- **Consistent terms:** Branch "sucursal" → "sede"; open mat "tatami libre" →
  "open mat"; rank "rango" → "grado"; stripe "grado" → "franja" where it meant
  a stripe; fees "tarifa" → "cuota" or "cargo" (rates stay "tarifa"); skill
  "técnica" → "habilidad"; ladder "escalera" → "escala"; Friend Pass "pase de
  amigo" → "pase de invitado"; join code "código de acceso" → "código de unión".
- **Wrong meaning fixed:** "You're invited to coach" said "Te han invitado a
  entrenar" (to train); "Paid" in payment history said "CORRECTO"; "Class
  moved" said "Clase cambiada".
- **Agreement:** "Se han reembolsado {amount}" → "Se reembolsó {amount}" (and
  "se cobra", "queda", "venció" with a single amount); pronouns after plaza →
  lugar ("Resérvalo").

## High-risk strings for a paid native reviewer

The full lists are in **`docs/translations/high-risk-pt-BR.csv`** and
**`docs/translations/high-risk-es.csv`** (columns: area, key, english,
translation, note): **460 strings per language**, the same keys in both.
Key prefixes: `portal:` is `apps/school-portal/src/i18n/messages/`,
`studentApp:` is `apps/student/src/i18n/messages/`, `server.` is
`packages/i18n/src/serverKeys/`, and `serverMessage:` is
`packages/i18n/src/server/` (where the English text itself is the key).

| Area | Strings |
|---|---|
| Waivers | 112 |
| Payments (member-facing, and the School's money rules) | 105 |
| Refunds | 90 |
| Consent for children | 38 |
| Contracts | 31 |
| Tax | 25 |
| Privacy, medical information, ad tracking | 20 |
| Closing, deleting and permanent data loss | 19 |
| Card surcharge | 15 |
| Early-exit fee | 5 |
| **Total** | **460** |

Every row has a note: a general one for its area, or one of these specific
notes, which are the strings to look at first:

| Lang | Key | English | Current text | Note |
|---|---|---|---|---|
| pt | `portal:layout.nav.waivers` | Waivers | Termos de responsabilidade | Nav label is 3.7x the English. "Termos" is shorter but may be read as Terms of Service. |
| pt | `studentApp:navigation.app.waivers` | Waivers | Termos de responsabilidade | App menu label is long. "Termos" is shorter but may be read as Terms of Service. |
| es | `portal:layout.nav.waivers` | Waivers | Exenciones | "Exención" kept as the neutral term. Mexico often says "carta responsiva", Argentina "deslinde de responsabilidad". |
| pt | `portal:membershipPlans.contract.earlyExitFeeLabel` | Early-exit fee | Multa por saída antecipada | "Multa por saída antecipada" kept. Brazilian contracts often say "multa por cancelamento antecipado" or "multa rescisória". |
| es | `portal:membershipPlans.contract.earlyExitFeeLabel` | Early-exit fee | Cargo por cancelación anticipada | Changed from "Tarifa por baja anticipada" to "Cargo por cancelación anticipada". Some markets say "penalización". |
| pt | `portal:charges.settings.taxIdLabel` | Tax ID | Inscrição fiscal (CNPJ) | "(CNPJ)" was added in the draft. A sole-trader School might use a CPF instead. |
| es | `portal:charges.settings.taxIdLabel` | Tax ID | Identificación fiscal | Was "NIF" (Spain only). Now the generic "Identificación fiscal": each country has its own ID (RFC, CUIT, RUT, NIT, RUC). |
| pt | `portal:schools.cardSurcharge.legalConfirm` | I confirm surcharges are legal where my School operates | Confirmo que acréscimos são legais onde minha escola atua | The School confirms legality itself. Check the wording of the confirmation. |
| es | `portal:schools.cardSurcharge.legalConfirm` | I confirm surcharges are legal where my School operates | Confirmo que los recargos son legales donde opera mi escuela | The School confirms legality itself. Check the wording of the confirmation. |
| pt | `portal:waivers.retention.note` | Signed waivers are kept while the person is a member and for 7 years after they leave (until age 25 for a child, if later), then deleted automatically. | Os termos assinados são guardados enquanto a pessoa for membro e por 7 anos depois que ela sair (até os 25 anos no caso de uma criança, se for depois), e então excluídos automaticamente. | States the legal retention period (7 years, to age 25 for a child). Check it. |
| es | `portal:waivers.retention.note` | Signed waivers are kept while the person is a member and for 7 years after they leave (until age 25 for a child, if later), then deleted automatically. | Las exenciones firmadas se conservan mientras la persona es miembro y durante 7 años después de que se vaya (hasta los 25 años en el caso de un menor, si es más tarde), y luego se eliminan automáticamente. | States the legal retention period (7 years, to age 25 for a child). Check it. |
| pt | `studentApp:guardians.myMinors.consentLabel` | I give consent for this child under the ULTM8 privacy notice (needed before they can book or check in). | Dou consentimento para esta criança conforme o aviso de privacidade do ULTM8 (necessário antes de ela poder reservar ou fazer check-in). | "Dou consentimento para esta criança" may read better as "Como responsável, dou meu consentimento ...". |
| pt | `studentApp:academies.childInvites.consent` | I give consent for {child} under the ULTM8 privacy notice. | Dou consentimento para {child} conforme o aviso de privacidade do ULTM8. | "Dou consentimento para {child}" may read better as "Como responsável por {child}, dou meu consentimento ...". |
| es | `studentApp:guardians.myMinors.consentLabel` | I give consent for this child under the ULTM8 privacy notice (needed before they can book or check in). | Doy mi consentimiento para este niño según el aviso de privacidad de ULTM8 (necesario para que pueda reservar o hacer check-in). | "Doy mi consentimiento para este niño" may read better as "Como padre, madre o tutor, doy mi consentimiento ...". |
| es | `studentApp:academies.childInvites.consent` | I give consent for {child} under the ULTM8 privacy notice. | Doy mi consentimiento para {child} según el aviso de privacidad de ULTM8. | "Doy mi consentimiento para {child}" may read better as "Como padre, madre o tutor de {child}, doy mi consentimiento ...". |
| pt | `studentApp:memberships.contract.endsAfterTerm` | This membership stops when the minimum term ends. It doesn't renew. | Este plano termina quando o prazo mínimo acaba. Ele não renova. | "assinatura" (subscription) was changed to "plano" here: on a contract screen it could be read as "signature". |
| pt | `studentApp:memberships.contract.cancelFee` | Your contract's minimum term runs until {date}. If your membership ends before then, the early-exit fee of {amount} is added to your balance. | O prazo mínimo do seu contrato vai até {date}. Se seu plano terminar antes, a multa por saída antecipada de {amount} é lançada no seu saldo. | "assinatura" changed to "plano" to avoid reading it as "signature". Check the early-exit wording. |
| es | `portal:charges.lateFees.subtitle` | Add a late fee to a member's balance when a charge, or a card membership renewal that couldn't be collected, is still unpaid after the grace days. One late fee per payment, never repeated. It is never charged to a card automatically: the member pays it in the app or at the desk. | Agrega un recargo por retraso al saldo del miembro cuando un cargo, o una renovación de membresía con tarjeta que no se pudo cobrar, sigue sin pagarse tras los días de gracia. Un recargo por pago, nunca repetido. Nunca se cobra automáticamente con tarjeta: el miembro lo paga en la app o en recepción. | "recargo por retraso" for late fee; LatAm also says "recargo por mora". "recargo" is also the card surcharge ("recargo por tarjeta"). |
| pt | `portal:charges.lateFees.subtitle` | Add a late fee to a member's balance when a charge, or a card membership renewal that couldn't be collected, is still unpaid after the grace days. One late fee per payment, never repeated. It is never charged to a card automatically: the member pays it in the app or at the desk. | Adicione uma multa por atraso ao saldo do membro quando uma cobrança, ou uma renovação de plano no cartão que não pôde ser cobrada, continuar sem pagamento depois dos dias de carência. Uma multa por pagamento, nunca repetida. Ela nunca é cobrada no cartão automaticamente: o membro paga no app ou na recepção. | "multa por atraso" for late fee; Brazilian consumer law (CDC art. 52 §1) is commonly read as capping late-payment fines at 2%. Check the setting text. |
| pt | `portal:schools.close.confirmBody` | You can't undo this yourself. Type the School's name and your passcode to confirm. | Você não pode desfazer isso sozinho. Digite o nome da escola e seu código de acesso para confirmar. | Passcode is now "código de acesso" everywhere (the draft mixed in "senha"). |
| es | `server.notifications.chargeDisputeLostBody` | The dispute on your card payment of {amount} was decided in your favour. The money goes back to your card. | La disputa de tu pago con tarjeta de {amount} se resolvió a tu favor. El dinero vuelve a tu tarjeta. | Mirrors the English: the key says "lost" but the text tells the payer the dispute was decided in their favour. |
| pt | `server.notifications.chargeDisputeLostBody` | The dispute on your card payment of {amount} was decided in your favour. The money goes back to your card. | A contestação do seu pagamento com cartão de {amount} foi decidida a seu favor. O dinheiro volta para o seu cartão. | Mirrors the English: the key says "lost" but the text tells the payer the dispute was decided in their favour. |
## Labels that may not fit

Buttons, tabs and menu labels where the translation is more than 1.5 times the
English (117 in all, mostly "Adicionar …"/"Agregar …", which is normal
expansion). Ones worth checking on a narrow screen:

- pt-BR menu "Termos de responsabilidade" for Waivers (portal and app; 3.7×).
  A shorter "Termos" could be confused with Terms of Service, so it was left.
- es tab "Disciplinas y Cinturones" (Styles & Belts), nav "Plan de estudios"
  (Curriculum), "Iniciar sesión" (Log in) on the app's login button.
- pt-BR "Matricular de novo" / es "Volver a inscribir" (Re-enrol), pt-BR
  "Adicionar graduação" (Add rank), pt-BR "Não compareceu" (No-show).

## Not settled

- **Waiver term in Spanish.** "Exención (de responsabilidad)" is kept as the
  neutral term. Mexico says "carta responsiva", Argentina "deslinde de
  responsabilidad", Chile and Colombia often "exoneración de responsabilidad".
  A per-country variant (es-MX, es-AR) would be a product decision.
- **Early-exit fee in Portuguese.** "Multa por saída antecipada" kept; a
  lawyer may prefer "multa por cancelamento antecipado" or "multa rescisória".
- **"assinatura" in Portuguese** means both subscription and signature. It
  was replaced on contract and desk screens; other uses (Subscription plans,
  "Cancelar assinatura") remain, and a reviewer may prefer "plano recorrente".
- **Style vs Discipline.** English uses both words for the same thing; both
  translations follow English (pt "estilo"/"modalidade", es
  "estilo"/"disciplina"). Unifying to "modalidade" / "disciplina" would need
  gender agreement changes in about 95 strings per language.
- **Instructor vs coach** in Portuguese: "instrutor" (role, page) and
  "professor" (coach) both appear, as English uses both words.
- **Capital letters.** English capitalises School, Branch, Student, Class; the
  translations mix "Escola"/"escola", "Escuela"/"escuela" (about 120 capitalised
  mid-sentence in each). Some are page names. Left as is.
- **"Ajustes" vs "Configuración"** (Settings) in Spanish: both are used
  (28 / 20); both are understood. Left as is.
- **Timetable "franja"** in Spanish: a timetable slot is "franja (horaria)",
  and a stripe is now also "franja". The context differs, but a reviewer may
  prefer "horario" for slots.
- **Generic masculine** for an unknown person ("Você foi convidado",
  "Bienvenido", "Ex-aluno"), as Brazilian and Latin American interfaces
  usually do. A gender-neutral wording would be a product decision.
- **Pix** appears in Spanish text because the English names it (desk payment
  methods). It is Brazil-only; the English may want a country-aware list.
- **Tax ID label in Portuguese** says "(CNPJ)"; a School run by a sole trader
  might use a CPF.
- Long explanatory hints outside the high-risk areas were checked by term
  searches, not read line by line.
