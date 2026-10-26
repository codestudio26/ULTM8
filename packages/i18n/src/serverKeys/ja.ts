import type { PartialMessages } from '../types';
import type { ServerKeys } from './en';

/** Japanese — first-draft translation (Decision 273) of the `server` text: the API's
 * own English shown translated. Keys left out fall back to English. */
export const server: PartialMessages<ServerKeys> = {
  generic: {
    network: "サーバーに接続できませんでした。接続を確認して、もう一度お試しください。",
    badRequest: "リクエストを完了できませんでした。内容を確認して、もう一度お試しください。",
    unauthorized: "もう一度サインインする必要があるか、サインイン情報が正しくありません。",
    forbidden: "この操作を行う権限がありません。",
    notFound: "見つかりませんでした。削除された可能性があります。",
    conflict: "他の何かが変更されたか、これに依存しているため、実行できませんでした。",
    tooLarge: "ファイルが大きすぎるため、アップロードできません。",
    validation: "一部の内容が正しくありません。確認して、もう一度お試しください。",
    tooManyRequests: "試行回数が多すぎます。しばらく待ってから、もう一度お試しください。",
    serverError: "サーバーで問題が発生しました。少し待ってから、もう一度お試しください。",
    unexpected: "問題が発生しました。もう一度お試しください。",
  },
  codes: {
    classFull: "このクラスは満員です。代わりに生徒をキャンセル待ちに追加できます。",
    waitlistFirst: "このクラスにはすでに空きを待っている生徒がいます。キャンセル待ちに登録して順番をお待ちください。",
    bookingClosed: "このクラスの予約受付は終了しました。スタッフであれば引き続き追加できます。",
    classBusy: "現在このクラスには予約が集中しています。しばらくしてからもう一度お試しください。",
    checkInNotOpen: "このクラスのチェックインはまだ始まっていません。",
    checkInOpensAt: "このクラスのチェックインはまだ始まっていません。開始時刻：{time}",
    capacityBelowBooked: "すでに予約済みの生徒：{count}人。定員を {count} 以上に設定するか、先に一部の予約をキャンセルしてください。",
    bookedClassesChoice: "この時間枠の今後のクラスの一部に予約があります。移動、キャンセル、そのままのいずれかを選択してください。",
  },
  errors: {
    beltInHistoryDelete: "この帯は生徒の昇級履歴に含まれているため、削除できません。",
    beltInHistoryArchive: "この帯は生徒の昇級履歴に含まれているため、アーカイブできません。",
    beltDeclaredDelete: "インストラクターがこの帯を申告しているため、削除できません。",
    beltDeclaredArchive: "インストラクターがこの帯を申告しているため、アーカイブできません。",
    classHasDependents: "このクラスにはまだ次のものがあるため、アーカイブできません：{items}。",
    branchHasDependents: "この支店にはまだ次のものがあるため、アーカイブできません：{items}。先に移動または削除してください。",
    instructorHasDependents: "このインストラクターは次のものに割り当てられているため、アーカイブできません：{items}。先に別の担当者に割り当ててください。",
    schoolHasSubscription: "このスクールにはすでに有効なプラットフォームのサブスクリプションがあります。プラン変更にはまだ対応していません。",
    franchiseHasSubscription: "このフランチャイズにはすでに有効なプラットフォームのサブスクリプションがあります。プラン変更にはまだ対応していません。",
    schoolNoSubscription: "このスクールには解約できる有効なプラットフォームのサブスクリプションがありません。",
    franchiseNoSubscription: "このフランチャイズには解約できる有効なプラットフォームのサブスクリプションがありません。",
    rankLocked: "この生徒は、{style} · {classType}のクラスが解放される級にまだ達していません。",
    rankLockedAnyStyle: "この生徒は、この種目の{classType}クラスが解放される級にまだ達していません。",
    rankLockedStaffOverride: "スタッフは1回の予約に限り、この制限を解除できます。",
    gradingPermissionMissing: "この種目でのあなたの昇級権限には次の項目が含まれていません：{toggle}。スクールオーナーが有効にできます。",
    slotHasBookings: {
      other: "この時間枠のクラスにまだ{count}件の今後の予約があるため、アーカイブできません。",
    },
    waiverHasSignatures: {
      other: "この免責同意書には{count}件の署名・割り当て記録（法的記録）があるため、アーカイブできません。必要であれば、そのまま編集することはできます。",
    },
    styleHasStudents: {
      other: "この種目で級を持つ生徒が{count}人いるため、削除できません。",
    },
    beltHeldDelete: {
      other: "この帯を持つ生徒が{count}人いるため、削除できません。",
    },
    beltHeldArchive: {
      other: "この帯を持つ生徒が{count}人いるため、アーカイブできません。",
    },
    items: {
      upcomingBookings: {
        other: "今後の予約{count}件",
      },
      waitlistStudents: {
        other: "キャンセル待ちの生徒{count}人",
      },
      classes: {
        other: "クラス{count}件",
      },
      instructorProfiles: {
        other: "インストラクタープロフィール{count}件",
      },
      homeStudents: {
        other: "ここを所属支店とする生徒{count}人",
      },
      roleGrants: {
        other: "ここに割り当てられた有効なスタッフ・インストラクターの役割{count}件",
      },
      upcomingClasses: {
        other: "今後のクラス{count}件",
      },
      activeSlots: {
        other: "有効な時間枠{count}件",
      },
    },
  },
  notifications: {
    spotOpenedTitle: "空きが出ました",
    spotOpenedBody: "{class}に空きが出ました。お早めに確保してください。確保しない場合は、キャンセル待ちの次の方に回ります。",
    readyToGradeTitle: "審査可能",
    readyToGradeBody: "{name}さんは{rank}の審査が可能です（{style}）。",
    readyToGradeBodyNextRank: "{name}さんは次の級の審査が可能です（{style}）。",
    paymentRestrictedTitle: "生徒の支払い方法が制限されました",
    paymentRestrictedBody: "カードの異議申し立てで何度も負けたため、スクールの生徒1名の支払い方法が現金または銀行振込のみに制限されました。",
    waiverRequestTitle: "免責同意書への署名のお願い",
    waiverRequestBody: "次の免責同意書への署名をお願いします：{waiver}。",
    newStripeTitle: "新しいストライプ！",
    promotedTitle: "昇級！",
    rankUpdatedTitle: "級が更新されました",
    youEarned: "{rank}を獲得しました。（{style}）",
    youPromoted: "{rank}に昇級しました。（{style}）",
    youAdjusted: "あなたの級は{rank}に調整されました。（{style}）",
    childEarned: "{name}さんが{rank}を獲得しました。（{style}）",
    childPromoted: "{name}さんが{rank}に昇級しました。（{style}）",
    childAdjusted: "{name}さんの級は{rank}に調整されました。（{style}）",
    yourChildEarned: "お子さまが{rank}を獲得しました。（{style}）",
    yourChildPromoted: "お子さまが{rank}に昇級しました。（{style}）",
    yourChildAdjusted: "お子さまの級は{rank}に調整されました。（{style}）",
    disputeLostTitle: "支払いの異議申し立てに敗れました",
    disputeResolvedTitle: "支払いの異議申し立てが解決しました",
    disputeOpenedTitle: "支払いの異議申し立てが行われました",
    membershipPayment: "会員費の支払い",
    franchiseFeeCharge: "フランチャイズ料金の請求",
    disputeLostBody: "異議申し立てのあった{amount}の{charge}について、異議申し立てに敗れました。この請求は支払い済みとは見なされなくなります。",
    disputeResolvedBody: "異議申し立てのあった{amount}の{charge}は、こちらに有利な形で解決しました。",
    disputeOpenedBody: "{amount}の{charge}について、支払者が異議を申し立てました（ステータス：{status}）。",
    disputeStatus: {
      warning_needs_response: "問い合わせ・要回答",
      warning_under_review: "問い合わせ・審査中",
      warning_closed: "問い合わせ・終了",
      needs_response: "要回答",
      under_review: "審査中",
      won: "勝利",
      lost: "敗北",
      prevented: "防止済み",
    },
  },
};
