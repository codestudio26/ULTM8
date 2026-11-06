# Translation review: the other 12 languages

**Date:** 6 Nov 2026. **Scope:** Arabic (ar), German (de), French (fr),
Italian (it), Japanese (ja), Korean (ko), Dutch (nl), Polish (pl), Russian
(ru), Thai (th), Turkish (tr) and Chinese, simplified (zh-CN). Brazilian
Portuguese and Spanish are reviewed separately.

**Text covered:** 6,169 strings per language. That is 4,259 in the School
Portal (`apps/school-portal/src/i18n/messages/`), 973 in the member app
(`apps/student/src/i18n/messages/`), 288 keyed server texts, notifications
included (`packages/i18n/src/serverKeys/`), and 649 API error messages
(`packages/i18n/src/server/`).

**This is a machine-assisted review, not a native-speaker sign-off.** Every
catalogue is still a first draft (Decision 273). Before each market launches,
a native speaker should check the strings listed under "Check before launch".

## How the review was done

1. Every catalogue was loaded and compared with the English, key by key.
2. Scripted checks looked for:
   - text left in English;
   - inconsistent terms, by counting each language's word for each
     glossary term;
   - mixed formality (du/Sie, tu/vous, sen/siz, 해요/합니다 and so on);
   - first-person text that only works for one gender;
   - arrows that point the wrong way in right-to-left text;
   - button and tab labels more than about 1.5 times as long as the English.
3. The strings most likely to cause legal or money problems were read by
   hand in all 12 languages: waivers, consent for children, medical
   consent, account deactivation, refunds, contracts, surcharges and tax.
4. Clear errors were fixed. Only the text changed: no key, `{placeholder}`
   or plural form was added, removed or renamed. The key-completeness test
   (`catalogue.test.ts` in each app) and the API's
   `server-messages-translated.spec.ts` still pass.

Already checked by the tests, and found correct: every key is present, the
placeholders match the English, and each plural message has every form the
language needs. Arabic has zero, one, two, few, many and other. Polish and
Russian have one, few, many and other. Japanese, Korean, Chinese and Thai
have "other" only.

## Glossary

These are the terms each language should use. **Bold** marks a term this
review changed so that a language uses one word throughout. *Mixed* means
the catalogue still uses more than one word for the term. A native reviewer
should choose one (see the per-language notes).

| English | ar | de | fr | it | ja | ko | nl | pl | ru | th | tr | zh-CN |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| belt | حزام | Gürtel | ceinture | cintura | 帯 | 띠 | band | pas | пояс | สายคาด | kuşak | 腰带 |
| stripe | شريط | Streifen | barrette | **striscia** | ストライプ | 그랄 | streep | belka | полоска | แถบ | şerit | 条纹 |
| rank / grade | رتبة (*mixed* with درجة) | **Grad** | grade | grado | ランク (*mixed* with 級, 段位) | **등급** | graad | stopień | ранг (*mixed* with ступень) | ระดับ | derece | 级别 (*mixed* with 段位) |
| grading / promotion | ترقية | **Graduierung, graduieren** | passage de grade, promotion | promozione, esame | 昇級, 審査 | 승급 | gradering, promoveren | awans, stopnie | аттестация | การเลื่อนระดับ | kuşak sınavı, terfi | 晋级 |
| open mat | تدريب حر | Open Mat | tatami libre | open mat | オープンマット | 오픈 매트 | open mat | open mat | открытый ковёр | โอเพนแมต | serbest antrenman | 自由练习 |
| Class Pack | باقة حصص | **Kurspaket** | carnet de cours (*mixed* with carte de cours) | pacchetto lezioni (*mixed* with carnet) | 回数券 | 수업 패키지 (*mixed* with 수업권) | lessenkaart | pakiet zajęć (*mixed* with karnet) | пакет занятий | แพ็กคลาส | ders paketi | **课时包** |
| membership / plan | عضوية / خطة | Mitgliedschaft / Tarif | adhésion (*mixed* with abonnement) / formule | abbonamento (*mixed* with iscrizione) / piano | 会員プラン (*mixed*) / プラン | 회원권 (*mixed* with 멤버십) / 플랜 | lidmaatschap / plan | członkostwo (*mixed* with karnet) / plan | абонемент / тариф | สมาชิกภาพ / แผน | üyelik / plan | 会员资格 (*mixed* with 会员) / 计划 |
| freeze | تجميد | einfrieren | gel, geler | sospensione | 休会 | 일시정지 | bevriezen | zamrożenie | заморозка | พักสมาชิก | dondurma | 冻结 |
| waiver | إقرار إخلاء المسؤولية | Haftungsausschluss | décharge | liberatoria | 免責同意書 | 면책 동의서 | vrijwaring | oświadczenie | отказ от ответственности | เอกสารสละสิทธิ์ | feragatname | 免责声明 |
| Guardian / parent | ولي الأمر | Erziehungsberechtigte(r) | tuteur (*mixed* with responsable légal) | tutore | 保護者 | 보호자 | ouder of voogd | opiekun | опекун | ผู้ปกครอง | veli | 监护人 |
| check-in | تسجيل الحضور | Check-in, einchecken | pointage, pointer | check-in | チェックイン | 출석 체크, 체크인 | inchecken | meldowanie | отметка | เช็กอิน | giriş | 签到 |
| front desk | الاستقبال | Empfang | accueil | reception | 受付 | **프런트 데스크** | balie, receptie | recepcja | ресепшен | เคาน์เตอร์, แผนกต้อนรับ | resepsiyon | 前台 |
| School | مدرسة | Schule | école | scuola | **スクール** | **도장** | school | szkoła | школа | โรงเรียน | okul | 学校 (道馆 in the member app's "Academies") |
| Branch | فرع | Filiale | succursale, site | sede | 支店 | 지점 | vestiging | oddział | филиал | สาขา | şube | 分校 |
| Franchise | امتياز | Franchise | franchise | franchising | フランチャイズ | 프랜차이즈 | franchise | franczyza | франшиза | แฟรนไชส์ | franchise | 加盟 |
| coach | مدرّب | Trainer | coach | allenatore, istruttore | コーチ | 코치 | coach | trener | тренер | โค้ช | antrenör | 教练 |
| instructor | مدرّب (the same word as coach) | Ausbilder | instructeur | istruttore | インストラクター | 사범 | instructeur | instruktor | инструктор | ผู้ฝึกสอน | eğitmen | 教练员 |
| Student | طالب | Schüler | élève | allievo | 生徒 | **수련생** | leerling | uczeń | ученик | นักเรียน | öğrenci | 学员 |
| School owner | مالك المدرسة | Schulinhaber | propriétaire de l'école | titolare della scuola | スクールオーナー | **도장 원장** | schooleigenaar | właściciel szkoły | владелец школы | เจ้าของโรงเรียน | okul sahibi | 学校负责人 |
| sign-up | تسجيل | Anmeldung | inscription | iscrizione | 入会申込 | 가입 신청 | aanmelding | zapis | заявка | การสมัคร | kayıt | 报名 |
| waiting list | قائمة الانتظار | Warteliste | liste d'attente | lista d'attesa | キャンセル待ち | 대기자 명단 | wachtlijst | lista oczekujących | лист ожидания | รายชื่อรอ | bekleme listesi | 候补名单 |
| joining fee | رسوم الانضمام | Aufnahmegebühr | frais d'inscription | quota di iscrizione | 入会金 | 가입비 | inschrijfgeld | opłata wpisowa | вступительный взнос | ค่าแรกเข้า | katılım ücreti | 入会费 |
| early-exit fee | **رسوم الإنهاء المبكر** | Gebühr für vorzeitige Kündigung | frais de résiliation anticipée | penale di recesso anticipato | 途中解約料 | 중도 해지 수수료 | opzegkosten | opłata za wcześniejsze rozwiązanie | **плата за досрочное расторжение** | ค่าธรรมเนียมยกเลิกก่อนกำหนด | **erken fesih ücreti** | **提前解约费** |
| card surcharge | رسوم البطاقة الإضافية | Kartenzuschlag | frais de carte | sovrapprezzo carta | カード手数料 | 카드 수수료 | kaarttoeslag | dopłata za kartę | надбавка за оплату картой | ค่าธรรมเนียมบัตร | kart ek ücreti | 刷卡附加费 |
| Erased User | مستخدم محذوف | Gelöschter Nutzer | Utilisateur effacé | Utente cancellato | 削除済みユーザー | 삭제된 사용자 | Gewiste gebruiker | Usunięty użytkownik | Удалённый пользователь | ผู้ใช้ที่ถูกลบ | Silinmiş kullanıcı | 已删除用户 |

"Erased User" is not in any catalogue yet. The decision log suggests it as
the placeholder name for an account whose personal data is erased. Use the
terms above if it is ever shown translated.

### How formal each language is

| Language | Form used | Notes |
|---|---|---|
| de | **du** | Four address-search and cancellation strings used "Sie" and now use "du". |
| fr | **vous** | 26 strings used "tu" and now use "vous". |
| it | **tu** | Consistent. |
| nl | **je** | Consistent. The "u" matches are the abbreviation for hours ("12 u"). |
| pl | **ty** (2nd person, lower case) | Consistent. |
| ru | **вы** | One string used "ты" and now uses "вы". |
| tr | **siz** | 67 strings used "sen" and now use "siz". Bare imperatives on buttons (Kaydet, Sil) are normal Turkish UI and stay as they are. |
| ja | polite です/ます | Consistent. |
| ko | **합니다** for statements; "~할까요?" for confirmation questions and "~세요" for requests | About 180 statements were in the informal 해요 style and now use 합니다. |
| zh-CN | 你 (about 460 strings; 您 in about 25) | Mostly consistent. A native reviewer may prefer 您 throughout for school owners. |
| ar, th | neutral or polite | Acceptable. |

## Per-language summary

Changes are counted as strings changed (a plural message counts once).

| Language | Changes | Main problems found | Confidence |
|---|---|---|---|
| ar | 13 | "Back" arrows pointing the wrong way in RTL (4); one chevron written as "‹", which showed backwards because RTL text mirrors chevrons automatically (now "›", as in English); awkward early-exit wording (7); a shorter Waivers menu label | medium |
| de | 196 | "Beförderung/befördern" (job promotion) used for grading, now "Graduierung/graduieren"; "Rang" and "Grad" both used for rank, now "Grad"; "Kurskarte" and "Kurspaket" both used, now "Kurspaket"; 4 "Sie" strings | medium-high |
| fr | 26 | 26 "tu" strings in a "vous" catalogue | medium-high |
| it | 34 | "grado" used for both rank and stripe, even on the same belt editor screen. Stripe is now "striscia"; rank stays "grado" | medium |
| ja | 20 | School called both スクール and 道場; now スクール throughout (道場 kept only in "my old club") | medium |
| ko | 484 | Mixed 해요/합니다 styles (about 180 strings); School called 학교, 스쿨, 학원 and 도장, now 도장; Student called 학생 and 수련생, now 수련생; rank called 랭크 and 등급, now 등급; front desk called 접수처 and 프런트, now 프런트 데스크; Korean particles adjusted to match each new word | medium |
| nl | 0 | Nothing clearly wrong found; terms and "je" are consistent | medium-high |
| pl | 2 | First-person text that only fits a man ("Przeczytałem…"); now gender-neutral | medium |
| ru | 8 | "досрочный выход" (literally "early exit") for the early-exit fee, now "досрочное расторжение"; one "ты" | medium |
| th | 0 | Nothing clearly wrong found | low-medium (least checked by hand) |
| tr | 74 | sen/siz mixed (67 strings, now siz); "erken çıkış" for the early-exit fee, now "erken fesih" | medium |
| zh-CN | 10 | "提前退出费" for the early-exit fee, now "提前解约费"; Class Pack called 课程包 and 课时包, now 课时包 | medium |

**Total: 867 strings changed.**

### Left for a native reviewer (not changed, because the fix is a choice)

- **Membership.** Several languages use two words for it: fr (adhésion and
  abonnement), it (abbonamento and iscrizione), ja, ko, zh-CN, pl (członkostwo
  and karnet). In fr and it the second word is also the word for a
  *Subscription* plan, so the two can be confused. Choose one word for
  "membership" and keep the other for "Subscription".
- **Rank** in ar (رتبة or درجة), ja (ランク, 級 or 段位), ru (ранг or ступень)
  and zh-CN (级别 or 段位). Japanese and Chinese also need a word that covers
  both kyu and dan grades, or a non-belt "level".
- **Class Pack** in fr, it, nl, pl and ko still uses two words.
- **Coach and instructor** are the same word in Arabic (مدرّب). They are
  different roles in the app.
- **German "Ausbilder"** for instructor sounds like a trade apprenticeship. A
  gym would say "Trainer" or "Instruktor", but "Trainer" is already the word
  for coach.
- **Korean**: owners may prefer 관장 (the usual title for the head of a
  dojang) to 도장 원장. Stripes are 그랄 (the Brazilian Jiu-Jitsu word) in most
  strings and 줄무늬 in descriptive text.
- **French Guardian**: mostly "tuteur", sometimes "responsable légal". For a
  parent, "parent ou responsable légal" is the safer legal wording.
- **Long labels** (more than 1.5 times the English) to check on screen:
  - de: Waivers menu "Haftungsausschlüsse", "Unterschriebene Dokumente
    exportieren", "Zurück zu den Haftungsausschlüssen";
  - fr: "Disciplines & Ceintures" tab, "Mettre en place les frais
    récurrents";
  - ru: Waivers menu "Отказы от ответственности";
  - tr: "Kuşak terfisi" in the menu (the coach dashboard says "Kuşak sınavı";
    choose one);
  - th: Grading and Waivers menu items.
  Other long labels are ordinary verb phrases (for example "Bearbeiten",
  "Enregistrer") that menus and buttons normally fit.
- **214 API error translations** in each language file no longer match any
  English message (the English was reworded). They are harmless, because they
  are never looked up, and could be removed in a separate clean-up.
- An English source oddity: `serverKeys` `notifications.waiverRequestBody`
  says "{waiver} has invited you to sign the following waiver.", with the
  waiver's name where the inviter should be. Some translations follow the
  meaning instead (nl and th: "You have been invited to sign: {waiver}"), so
  the English should be fixed first, then the translations.

## Check before launch

These are the strings a native speaker must read before each market goes
live. Most keys are the same in every language. Each language then has its
own notes.

**Every language:**

- **Waivers:** `waivers.guestPage.intro`, `waivers.guestPage.agree`,
  `waivers.settings.adult.on`, `waivers.settings.childSigns.*`,
  `waivers.paper.signerHint`, and the server texts about who may sign a
  waiver for a child.
- **Consent for children:** `guardians.consentTier.baselineWithdrawWarning`,
  `guardians.consentTier.acknowledge`, `students.guardiansCard.consentPending`,
  `students.guardiansCard.consentWithdrawn`, and `serverKeys`
  `codes.consentPending` and `codes.consentWithdrawn`.
- **Medical data:** `academies.join.medicalConsentMe`,
  `academies.join.medicalConsentOther`, `frontDesk.signUp.medicalConsent`,
  `profile.medical.confirm`.
- **Privacy, data export and closing an account:**
  `students.export.memberDataIntro`, `schools.close.explanation`,
  `schools.close.closedBody`, and `adTracking.whereUsed`.
- **Payments and refunds:** `transactions.refund.body`,
  `transactions.refund.joiningFeeKept`, `transactions.markPaidBody`,
  `schools.cancellations.policyHint.*`,
  `membershipPlans.studentCard.cancelDescription`,
  `memberships.myMemberships.cancelConfirm`.
- **Contracts:** `membershipPlans.contract.*`, `memberships.contract.*`
  (above all `cancelFee` and `guardianSigns`), `charges.earlyExitFee.*`.
- **Surcharges, late fees and tax:** `schools.cardSurcharge.*` (including
  `legalConfirm`), `charges.lateFees.*` (including `legalConfirm`),
  `charges.settings.pricesAddOnTop`, `charges.create.amountHintOnTop`,
  `branches.tax.*`, `transactions.row.includedTaxLine`.

**Language notes:**

- **ar:** the legal register of the waiver and consent text; the text speaks
  to a man throughout (for example "اختر" and "أدخل", never the feminine
  forms), which is usual in Arabic apps but worth a decision; whether "الإقرارات" is
  clear enough as the Waivers menu label; which way the arrows show on the
  real screens.
- **de:** whether "Haftungsausschluss" is the right legal term for the
  waiver (a lawyer may prefer "Haftungsverzichtserklärung"); "Graduierung"
  across the grading screens; whether "Erziehungsberechtigte(r)" and the
  medical consent wording meet the GDPR (DSGVO) wording for consent.
- **fr:** "décharge" for waiver, and "tuteur" against "responsable légal";
  "frais de carte" for the surcharge (it could be read as an ordinary card
  fee); "Taxes" against "TVA" on the tax screens.
- **it:** "liberatoria" for waiver; "striscia" across the belt editor; the
  wording of "penale di recesso anticipato" (there are consumer rules on
  early-exit penalties).
- **ja:** the 免責同意書 wording (a lawyer may want 同意書 or 誓約書); the
  dan/kyu choice for rank; the 休会 wording for a freeze.
- **ko:** the whole catalogue changed style, so read some screens of each
  area; 도장 and 수련생 in the member app; "면책 동의서" and the medical
  consent wording under Korea's PIPA (personal information protection law).
- **nl:** "vrijwaring" for waiver (many gyms say "disclaimer" or
  "vrijwaringsverklaring"); "ouder of voogd".
- **pl:** "oświadczenie" for waiver is broad (perhaps "oświadczenie o
  zrzeczeniu się roszczeń"); first-person gender in any other consent text.
- **ru:** "отказ от ответственности" for waiver; "опекун" for a parent (most
  Russian gyms say "родитель или законный представитель"); every
  "согласен(на)" string.
- **th:** the least-reviewed language. Read all waiver, consent and refund
  text in full, and check the long labels on narrow screens.
- **tr:** the 67 strings changed to "siz"; "feragatname" for waiver; the
  KVKK (Turkish data protection law) consent wording in the medical text.
- **zh-CN:** "免责声明" for waiver (a signed waiver is usually "免责协议" or
  "免责同意书"); 你 or 您 for school owners; 加盟 for Franchise.
