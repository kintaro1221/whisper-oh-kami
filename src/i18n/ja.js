// Japanese string table for WhisperOhKAMI UI.
// Keys are namespaced by surface (nav, main, onboarding, etc.)
// to keep the table scannable and easy to grep.
//
// Pattern follows src/utils/evidenceInspector.js — `module.exports` for
// require() in renderer (nodeIntegration is on) and for Jest, and a
// `window.WhisperI18nStrings.ja` attachment for any plain-script users.
const JA = {
    // ── サイドバー nav ──
    'nav.home': 'ホーム',
    'nav.ai_customize': 'AI カスタマイズ',
    'nav.history': '履歴',
    'nav.settings': '設定',
    'nav.feedback': 'フィードバック',
    'nav.help': 'ヘルプ',
    'nav.sidebar.collapse': 'サイドバーを折りたたむ',
    'nav.sidebar.expand': 'サイドバーを展開',

    // ── アプリ共通 ──
    'common.update_available': '更新があります',
    'common.hide': '非表示',
    'common.close': '閉じる',
    'common.session_end': 'セッション終了',
    'common.click_through': 'クリックスルー',
    'common.dismiss': '閉じる',

    // ── CheatingDaddyApp ──
    'app.recording_consent.message':
        '商談・ミーティングの音声を録音 / 文字起こしします。\n\n相手の参加者から事前合意を得ていますか？\n\n「OK」で開始 / 「キャンセル」で中止します。',
    'app.live_bar.end_session': 'セッション終了',
    'app.live_bar.session_fallback': 'セッション',
    'app.live_bar.click_through': '[クリックスルー]',
    'app.live_bar.hide': '[非表示]',
    'app.window_control.hide_tooltip': '非表示 (Ctrl+\\)',
    'app.window_control.close_tooltip': '閉じる',

    // ── 診断メッセージ ──
    'diagnostic.byok_missing_key.title': 'Gemini API キーが未入力です',
    'diagnostic.byok_missing_key.cause': 'BYOK モードでは、セッション開始前に Gemini API キーが必要です。',
    'diagnostic.byok_missing_key.action': 'Gemini キーを取得して、入力欄に貼り付けてください。',
    'diagnostic.byok_invalid_format.title': 'Gemini API キーの形式を確認してください',
    'diagnostic.byok_invalid_format.cause': '入力されたキーは Gemini API キーの一般的な形式と一致しません。',
    'diagnostic.byok_invalid_format.action': 'AI Studio で発行したキーをコピーし直してください。',
    'diagnostic.gemini_auth_failed.title': 'Gemini API キーで認証できませんでした',
    'diagnostic.gemini_auth_failed.cause': 'キーが無効、削除済み、権限不足、または利用制限に当たっている可能性があります。',
    'diagnostic.gemini_auth_failed.action': 'AI Studio でキーの状態と請求/利用制限を確認し、必要なら新しいキーを入力してください。',
    'diagnostic.gemini_network_failed.title': 'Gemini に接続できませんでした',
    'diagnostic.gemini_network_failed.cause': 'ネットワーク、プロキシ、VPN、または一時的なサービス障害の可能性があります。',
    'diagnostic.gemini_network_failed.action': '通信環境を確認してから、もう一度開始してください。',
    'diagnostic.ollama_unavailable.title': 'Ollama に接続できませんでした',
    'diagnostic.ollama_unavailable.cause': 'Ollama が起動していないか、接続先ホストが違う可能性があります。',
    'diagnostic.ollama_unavailable.action':
        'Ollama を起動し、ホスト設定を確認してください。未インストールの場合は ollama.com からインストールしてください。',
    'diagnostic.whisper_download_network_failed.title': 'Whisper モデルをダウンロードできませんでした',
    'diagnostic.whisper_download_network_failed.cause': '初回モデル取得中に、回線または Hugging Face への接続で失敗した可能性があります。',
    'diagnostic.whisper_download_network_failed.action': 'インターネット接続を確認し、少し待ってからもう一度試してください。',
    'diagnostic.whisper_download_disk_failed.title': 'Whisper モデルを保存できませんでした',
    'diagnostic.whisper_download_disk_failed.cause': 'ディスク容量不足、保存先の権限不足、またはセキュリティソフトのブロックの可能性があります。',
    'diagnostic.whisper_download_disk_failed.action': '空き容量とアプリの保存権限を確認してから再試行してください。',
    'diagnostic.deepgram_reconnecting.title': 'Deepgram の文字起こしを再接続中です',
    'diagnostic.deepgram_reconnecting.cause': 'Deepgram WebSocket が一時的に切断されました。',
    'diagnostic.deepgram_reconnecting.action': 'このまま数秒待ってください。復旧しない場合は Deepgram キーとネットワークを確認してください。',
    'diagnostic.deepgram_disconnected.title': 'Deepgram の文字起こしが切断されました',
    'diagnostic.deepgram_disconnected.cause': 'Deepgram WebSocket が切断され、音声文字起こしが止まっている可能性があります。',
    'diagnostic.deepgram_disconnected.action': 'Deepgram キー、通信環境、音声入力設定を確認してから再開始してください。',
    'diagnostic.audio_helper_failed.title': 'システム音声ヘルパーを起動できませんでした',
    'diagnostic.audio_helper_failed.cause': '音声キャプチャ用ヘルパーの起動、音声デバイス、または Windows WASAPI ループバックで失敗しました。',
    'diagnostic.audio_helper_failed.action': 'マイク/スピーカーの既定デバイスを確認し、必要ならアプリを再起動してください。',

    // ── ヘッダー / view titles ──
    'header.title.onboarding': 'WhisperOhKAMI へようこそ',
    'header.title.main': 'WhisperOhKAMI',
    'header.title.customize': 'AI コンテキスト',
    'header.title.help': 'ヘルプ・ショートカット',
    'header.title.history': '会話履歴',
    'header.title.advanced': '詳細設定',
    'header.title.assistant': 'WhisperOhKAMI',

    // ── メイン画面 ──
    'main.subtitle.byok': '自分の API キーを使う',
    'main.subtitle.local': 'ローカル環境でモデルを動かす',
    'main.mode_suffix.local': 'ローカル AI',
    'main.mode_link.to_local': 'ローカル AI を使う',
    'main.mode_link.to_byok': '自前の API キーを使う',
    'main.mode_link.to_trial': 'お試し（キー不要）に戻る',
    'main.trial.label': 'お試し（キー不要）',
    'main.trial.description': 'マイク音声だけを端末内Whisperで文字起こしし、5要素バーだけを動かします。',
    'main.trial.limits': 'AI応答、LLM refine、相手音声の取り込みは試用では無効です。',
    'main.trial.go_byok': 'Geminiキーを設定してAI応答を使う',
    'main.trial.go_local': 'OllamaローカルAIを使う',
    // {percent} {loaded} {total} are interpolated at the call site (t() has no built-in interpolation).
    'main.whisper.downloading_pct': 'Whisperモデルをダウンロード中… {percent}%（{loaded}/{total}MB）',
    'main.whisper.downloading': 'Whisperモデルを初回ダウンロード中です。',
    'main.whisper.first_run_note': '初回のみWhisperモデルをダウンロードします。',
    'main.whisper.auto_download_note': '初回利用時に自動でダウンロードされます。',
    'main.whisper.error': 'Whisperモデルのダウンロードに失敗しました。通信環境とディスク空き容量を確認して再試行してください。',
    'main.button.retry': '再試行',
    'main.button.start_session': 'セッションを開始',
    'main.divider.or': 'または',
    'main.divider.choose_mode': '開始する方法を選ぶ',
    'main.subtitle.app': '商談を聞いて、相手の話から要点をその場で可視化します。',
    'main.reassure.mic': 'マイク音声を端末内で文字起こしします（キー不要）',
    'main.reassure.bar': '会話に合わせて、課題・KPI・決裁・予算・期限の5要素バーが動きます',
    'main.advanced.title': '詳細設定',
    'main.advanced.hint': '通常はこのままでOK',
    'main.advanced.accuracy_note': '文字起こしの精度をさらに上げたい場合は、「自前キー」モードで Deepgram のクラウド文字起こしを使えます。',
    'main.mode_card.selected': '選択中',
    'main.mode_card.trial.title': 'お試し',
    'main.mode_card.trial.desc': 'キー不要',
    'main.mode_card.byok.title': '自前キー',
    'main.mode_card.byok.desc': 'Geminiで応答',
    'main.mode_card.local.title': 'ローカルAI',
    'main.mode_card.local.desc': 'Ollamaで実行',
    'main.audio.mic_label': 'マイク',
    // {id} = 短縮 deviceId (8 文字)。permission 未許可で label が空のときの fallback。
    'main.audio.mic_label_fallback': 'マイク ({id})',
    'main.audio.mic_default': 'システムデフォルト',
    'main.audio.mic_hint': 'セッション開始時にこのデバイスからマイク音声を取得します',
    'main.audio.system_label': 'システム音声',
    'main.audio.system_auto': '自動 (画面共有経由のループバック)',
    'main.audio.system_none': '使わない',
    'main.audio.system_hint': 'VB-CABLE / BlackHole 等の仮想ループバックデバイスを直接選べます',
    'main.api.gemini_label': 'Gemini API キー',
    'main.api.gemini_get': 'Gemini キーを取得',
    'main.api.groq_label': 'Groq API キー',
    'main.api.groq_get': 'Groq キーを取得',
    'main.api.placeholder.required': '必須',
    'main.api.placeholder.optional': '任意',
    'main.api.key_hint.invalid': 'キーは「AIza」で始まる 30 文字以上の形式です。コピーし直してください。',
    'main.api.key_hint.ok': '形式OK ✓（開始すると有効性を確認します）',
    'main.api.deepgram_label': 'Deepgram API キー（任意）',
    'main.api.deepgram_get': 'Deepgram キーを取得',
    'main.api.deepgram_consent':
        'クラウド文字起こし用（任意）。既定はローカル文字起こしのため、キーを入力しても自動では送信されません。設定 → 音声認識で「クラウド」を選んだときだけ有効になり、その間だけマイク／相手の音声が Deepgram（米国）に送信されます。',
    'main.api.deepgram_hint.invalid': 'Deepgram キーは 32 文字以上の英数字（16進）です。コピーし直してください。',
    'main.api.deepgram_hint.ok': '形式OK ✓（開始すると有効性を確認します）',

    // ── BYOK guided key wizard (②) ──
    'wizard.entry_button': '🧭 はじめての方：ガイド付きで設定',
    'wizard.or_direct': '— または直接入力 —',
    'wizard.back': '戻る',
    'wizard.next': '次へ',
    'wizard.skip': 'スキップ',
    'wizard.gemini.title': 'Gemini キーを取得（必須）',
    'wizard.gemini.lead': '無料枠でOK・課金なし・約1分。下のボタンで AI Studio を開き、「Create API key」を押します。',
    'wizard.gemini.open': 'AI Studio を開く',
    'wizard.deepgram.title': 'Deepgram キー（任意・文字起こし精度UP）',
    'wizard.deepgram.lead': '相手の声の文字起こし精度を上げます。任意です。下のボタンで Deepgram を開き、API キーを作成します。',
    'wizard.deepgram.open': 'Deepgram を開く',
    'wizard.deepgram.privacy': '⚠ 有効にすると音声（マイク／相手）が Deepgram（米国）に送信されます。',
    'wizard.verify.checking': '確認中…',
    'wizard.verify.ok': '✓ つながりました',
    'wizard.verify.invalid': '✗ このキーは無効です',
    'wizard.verify.network': '確認できませんでした（保存はしました）',
    'wizard.done.title': '準備できました',
    'wizard.done.start': 'セッションを開始',

    // ── ブランド ──
    'brand.tagline': 'ささやき女将',

    // ── オンボーディング ──
    'onboarding.slide1.body': '商談中の発話から「課題・KPI・決裁・予算・期限」をそっと拾い上げる、ヒアリング専用の AI コパイロット。',
    'onboarding.mode.title': 'はじめ方を選ぶ',
    'onboarding.mode.note': 'あとから設定でいつでも変更できます。',
    'onboarding.mode.trial.label': 'お試し（キー不要）',
    'onboarding.mode.trial.desc': 'すぐに試せます。マイク音声から5要素バーが動きます。AI 応答はありません。',
    'onboarding.mode.byok.label': '自分の API キー（おすすめ）',
    'onboarding.mode.byok.desc': 'Gemini キーを入れると AI 応答まで使えます。',
    'onboarding.mode.local.label': 'ローカル（オフライン）',
    'onboarding.mode.local.desc': 'Ollama で完全オフライン動作。外部送信ゼロ。',
    'onboarding.slide2.skip_note': '未入力のまま「はじめる」で進められます（あとから設定できます）。',
    'onboarding.slide2.title': '補足情報を追加',
    'onboarding.slide2.body':
        'あなたの背景・会社・商品情報など、AI に知っておいてほしい情報があれば貼り付けてください。後から追加することもできます。',
    'onboarding.slide2.placeholder': '補足したい背景情報・会社情報・商品情報など',
    'onboarding.button.continue': '次へ',
    'onboarding.button.get_started': 'はじめる',
    'onboarding.button.back': '戻る',

    // ── アシスタント (商談中) ──
    'assistant.button.analyze_screen': '画面を解析',
    'assistant.tooltip.previous_response': '前の回答',
    'assistant.tooltip.next_response': '次の回答',
    'assistant.empty.waiting_audio': '音声を待機中…',
    'assistant.input.placeholder': 'メッセージを入力…',

    // ── 設定: ページ全体 ──
    'customize.page.title': '設定',

    // ── 設定: 音声認識エンジン ──
    'customize.stt.title': '音声認識エンジン',
    'customize.stt.section_help':
        '商談音声をどのエンジンで文字起こしするかを選びます。既定はプライバシー重視のローカル。クラウド（Deepgram）は任意で、BYOK 設定で Deepgram キーを入れると有効になります。',
    'customize.stt.cloud.title': 'クラウド優先',
    'customize.stt.cloud.tag': '要 Deepgram キー',
    'customize.stt.cloud.help':
        'Deepgram nova-3 でリアルタイム文字起こし（任意）。BYOK 設定で Deepgram キーが必要です。マイク／スピーカー音声は Deepgram（米国）のサーバに送信されます。キーが無い場合は Gemini Live の文字起こしにフォールバックします。',
    'customize.stt.local.title': 'ローカル完結',
    'customize.stt.local.tag': '推奨',
    'customize.stt.local.help':
        'Deepgram への音声送信を停止します。注意: Gemini Live は依然マルチモーダル context として音声を受け取るため、完全ローカルではありません（README §倫理 / §STT モード参照）。完全ローカル化は次フェーズで対応。',

    // ── 設定: 音声入力 ──
    'customize.audio.title': '音声入力',
    'customize.audio.mode_label': '音声モード',
    'customize.audio.mode.speaker_only': 'スピーカーのみ（相手の声）',
    'customize.audio.mode.mic_only': 'マイクのみ（自分の声）',
    'customize.audio.mode.both': 'スピーカーとマイクの両方',
    'customize.audio.mode.warning': '予期しない挙動が発生する場合があります。理解した上で変更してください。',
    'customize.audio.quality_label': '画像品質',
    'customize.audio.quality.high': '高品質',
    'customize.audio.quality.medium': '中品質',
    'customize.audio.quality.low': '低品質',

    // ── 設定: 言語 ──
    'customize.language.title': '言語',
    'customize.language.stt_label': '音声認識言語',

    // ── 設定: 外観 ──
    'customize.appearance.title': '外観',
    'customize.appearance.theme_label': 'テーマ',
    'customize.appearance.transparency_label': '背景の透過度',
    'customize.appearance.font_size_label': '回答テキストのサイズ',

    // ── 設定: キーボード ──
    'customize.keybind.title': 'キーボードショートカット',

    // ── 設定: プライバシー / データ ──
    'customize.privacy.title': 'プライバシーとデータ',
    'customize.privacy.restoring': '初期化中...',
    'customize.privacy.restore_all': 'すべての設定を初期化',
    'customize.privacy.clearing': '削除中...',
    'customize.privacy.clear_all': 'すべてのデータを削除',
    'customize.privacy.cleared_local': 'ローカルデータをすべて削除しました',
    'customize.privacy.quitting': 'アプリを終了します...',
    // {message} = JS Error.message。テンプレ内に展開する。
    'customize.privacy.clear_error': 'データ削除エラー: {message}',
    'customize.support_export.button': 'サポート用に書き出す',
    'customize.support_export.exporting': '書き出し中...',
    'customize.support_export.success': 'サポート用診断を書き出しました: {path}',
    'customize.support_export.error': 'サポート用書き出しエラー: {message}',

    // ── 設定: プロファイル ──
    'profile.discovery': '課題ヒアリング',
    'profile.sales': '営業商談',
    // Legacy profile names (sessions recorded under now-removed profiles)
    'profile.interview': '面接',
    'profile.meeting': '会議',
    'profile.presentation': 'プレゼン',
    'profile.negotiation': '交渉',
    'profile.exam': '試験アシスタント',

    // ── 設定: キーバインド ──
    'customize.keybind.placeholder': 'キー操作を入力…',
    'customize.keybind.reset': '初期値に戻す',

    // ── ヘルプ画面 ──
    'help.title': 'ヘルプ',
    'help.support.title': 'サポート',
    'help.keybind.registered': '登録済み',
    'help.keybind.unregistered': '未登録',
    'help.keybind.register_failed': '登録に失敗しました',
    'help.keybind.unset': '未設定',
    'help.link.website': 'ウェブサイト',
    'help.link.source_code': 'ソースコード',
    'help.shortcuts.title': 'キーボードショートカット',
    'help.shortcut.move_up': 'ウィンドウを上へ移動',
    'help.shortcut.move_down': 'ウィンドウを下へ移動',
    'help.shortcut.move_left': 'ウィンドウを左へ移動',
    'help.shortcut.move_right': 'ウィンドウを右へ移動',
    'help.shortcut.toggle_visibility': '表示・非表示切替',
    'help.shortcut.toggle_click_through': 'クリックスルー切替',
    'help.shortcut.next_step': 'AI に次のステップを尋ねる',
    'help.shortcut.previous_response': '前の回答',
    'help.shortcut.next_response': '次の回答',
    'help.shortcut.scroll_up': '回答を上にスクロール',
    'help.shortcut.scroll_down': '回答を下にスクロール',
    'help.section.shortcuts': 'ショートカット',
    'help.section.during_negotiation': '商談中',
    'help.negotiation.right_rail_desc': '右レールでコンテキスト、不足5要素、短いヘルプ、提案フィードバックを確認します。',
    'help.negotiation.feedback_recording_desc': '提案がズレた、危ない、役立つと思ったらその場で記録します。内容はローカル履歴に残ります。',
    'help.section.preparation': '準備',
    'help.preparation.context_setup_desc': 'AI コンテキストで商材、想定顧客、商談ゴール、制約を先に入れておきます。',
    'help.preparation.consent_desc': '録音開始前に、相手参加者から録音・文字起こしの合意を得てください。',
    'help.section.faq': 'よくある質問・困ったとき',
    'help.faq.gemini_key_format':
        '「Gemini API キーが未入力／形式が違う」と出る → キー入力欄の下の表示で形式を確認し、AI Studio（aistudio.google.com/apikey）で発行したキーをコピーし直します。キーは「AIza」で始まる 30 文字以上です。',
    'help.faq.gemini_auth_connection':
        '「Gemini で認証できない／接続できない」と出る → 認証エラーはキーの有効性・利用制限を AI Studio で確認します。接続エラーは通信環境（プロキシ／VPN）を確認してから、もう一度開始します。',
    'help.faq.trial_slow':
        'お試しモードが重い・遅い → 端末内 Whisper は CPU のみだと遅延が出ます。Whisper はまず Tiny（最速）を選び、重い場合はマイクのみで試します。',
    'help.faq.speaker_audio_not_captured':
        '相手の声が文字起こしされない → 設定の「システム音声」で「自動（画面共有経由）」または仮想ループバックデバイスを選びます。お試しモードはマイク（自分の声）のみが対象です。',
    'help.faq.ollama_connection':
        'Ollama に接続できない → ローカル AI は Ollama の起動が必要です。ollama.com からインストールし、起動してからホスト設定を確認します。',
    'help.faq.whisper_download':
        'Whisper モデルのダウンロードが終わらない／失敗する → 初回のみモデルを取得します。通信環境とディスク空き容量を確認し、表示される再試行で再開します。',
    'help.faq.audio_helper_failed':
        'システム音声ヘルパーが起動しない（Windows） → 既定のマイク／スピーカーデバイスを確認し、必要ならアプリを再起動します。',
    'help.faq.transcription_stopped': '文字起こしが止まった → 音声デバイス、ネットワーク、システム音声の設定を確認します。',
    'help.faq.shortcut_not_working': 'ショートカットが効かない → 下の登録状態で OS や他アプリとの衝突を確認します。',
    'help.section.license': 'ライセンス・オープンソース',
    'help.license.gpl_notice': '本アプリは GPL-3.0 で提供されるオープンソースソフトウェアです。同梱の LICENSE ファイルに全文が含まれます。',
    'help.license.fork_notice': 'sohzm/cheating-daddy の派生版（fork）です。元プロジェクトの著作権表示を尊重しています。',
    'help.license.font_notice': '同梱フォント（Noto Sans JP）は SIL Open Font License 1.1 で提供されています。',
    'help.license.packages_notice': '利用しているオープンソースパッケージの一覧とライセンスは、同梱の THIRD_PARTY_NOTICES.md に記載しています。',

    // ── 履歴画面 ──
    'history.title': '履歴',
    'history.detail.title': 'セッション詳細',
    'history.search.placeholder': 'セッションを検索…',
    'history.loading': 'セッションを読み込み中…',
    'history.empty.no_match': '一致するセッションがありません。',
    'history.empty.select': 'セッションを選択してください。',
    'history.empty.no_conversation': '会話データがありません。',
    'history.empty.no_screen': '画面解析データがありません。',
    'history.empty.no_context': 'このセッションのコンテキストはありません。',
    'history.session.fallback': 'セッション',
    'history.session.empty': '空のセッション',
    'history.session.messages': '{count} 件のメッセージ',
    'history.session.screen': '{count} 画面解析',
    'history.tab.conversation': '会話',
    'history.tab.screen': '画面解析',
    'history.tab.context': 'コンテキスト',
    'history.tab.feedback': 'フィードバック',
    'history.context.profile': 'プロファイル',
    'history.context.prompt': 'プロンプト',
    // Feedback tab within history
    'history.empty.no_feedback': '保存されたフィードバックはありません。',
    'history.feedback.response_label': '回答',
    'history.feedback.note_empty': 'メモなし',

    // ── フィードバック画面 ──
    'feedback.title': 'フィードバック',
    'feedback.lead': 'WhisperOhKAMI をより良くするために、ご意見・不具合のご報告を歓迎します。',
    'feedback.privacy_note': 'このアプリは利用状況を自動送信しません。フィードバックは、あなたがご自身でメールを送ったぶんだけが届きます。',
    'feedback.local_note': '商談画面で提案につけたフィードバック（「役立つ」など）は、この端末内の履歴にだけ保存されます（外部送信はありません）。',
    'feedback.email_button': 'メールでフィードバックを送る',
    'feedback.pending': 'フィードバック窓口は準備中です。次回アップデートでご案内します。',
    // Rating labels (shared: HistoryView + AssistantView)
    'feedback.rating.helpful': '役立つ',
    'feedback.rating.off_target': 'ズレた',
    'feedback.rating.unsafe': '危ない',

    // ── アシスタント (商談中) 追加キー ──
    'assistant.session.label': 'セッション',
    'assistant.status.listening': 'を聞いています...',
    'assistant.badge.self_mention_hint': '自分が話したが相手未確認',
    'assistant.evidence.empty': 'まだ該当発言が取れていません。',
    'assistant.evidence.self_mentions_section': '自分の言及（相手未確認）',
    'assistant.evidence.unconfirmed': '未確認',
    'assistant.context.field.company_product': '商材',
    'assistant.context.field.target_customer': '顧客',
    'assistant.context.field.meeting_goal': 'ゴール',
    'assistant.context.field.customer_background': '背景',
    'assistant.context.field.constraints': '制約',
    'assistant.context.field.free_instruction': '自由欄',
    'assistant.progress.title': 'ヒアリング進捗',
    'assistant.help.discovery_start': 'まず相手の発言を待ち、課題とゴールを相手の言葉で確認します。',
    'assistant.help.discovery_gap': 'が未充足です。提案を急がず、事実確認の質問を1つだけ返します。',
    'assistant.help.discovery_complete': '5要素は一通り確認済みです。次アクション、合意条件、懸念点を短く整理します。',
    'assistant.help.default': '必要に応じて「次の一手」を使い、画面分析は入力欄右のボタンで実行します。',
    'assistant.feedback.no_response': '保存できるAI提案がまだありません。',
    'assistant.feedback.session_not_ready': 'セッション履歴の準備中です。少し待ってから再度保存してください。',
    'assistant.feedback.saved': 'フィードバックをローカル履歴に保存しました。',
    'assistant.feedback.save_error': '保存に失敗しました: ',
    'assistant.feedback.note_placeholder': '任意メモ',
    'assistant.rail.context_title': '現在のコンテキスト',
    'assistant.rail.context_empty': 'AI コンテキスト画面で商材・顧客・商談ゴールを設定できます。',
    'assistant.rail.gaps_title': '不足している5要素',
    'assistant.rail.gaps_empty_profile': '営業・Discoveryプロファイルで5要素の不足を表示します。',
    'assistant.rail.gaps_filled': '5要素は一通り埋まっています。',
    'assistant.rail.help_title': 'この場面で使えるヘルプ',
    'assistant.rail.feedback_title': 'この提案へのフィードバック',
    'assistant.rail.aria_label': '商談中ワークベンチ補助情報',
    // 5要素ラベル (DRY: _renderDiscoveryProgress + _getDiscoveryGaps 共用)
    'assistant.discovery.element.pain': '課題',
    'assistant.discovery.element.kpi': 'KPI',
    'assistant.discovery.element.authority': '決裁',
    'assistant.discovery.element.budget': '予算',
    'assistant.discovery.element.timeline': '期限',

    // ── AI コンテキスト画面 (AICustomizeView) ──
    'aicx.page_title': 'AI コンテキスト',
    'aicx.page_subtitle': 'ここに書いた前提を、商談中の AI 提案に反映します。書くほど提案が的確になります。',
    'aicx.framing_note_main': '課題・予算・決裁・期限・KPI は商談中に5要素バーが聞き取ります。ここはその土台になる「前提」だけでOK。',
    'aicx.framing_note_emphasis': 'まずは ① と ③ から。',
    'aicx.footer_note':
        '入力は自動で保存され、次の商談から反映されます。この内容を元に、商談中の提案や次の質問があなたの状況に合わせて調整されます。',
    'aicx.status_saving': '保存中…',
    'aicx.status_saved': '✓ 保存しました',
    'aicx.mode_title': '提案モード',
    'aicx.mode_desc': '商談中に AI がどんな提案を優先するかを選びます。',
    'aicx.radiogroup_label': '提案モード',
    // {hint} = this._legacyHint (interpolated at call site)
    'aicx.legacy_hint_template': '以前の自由メモ: {hint}',
    'aicx.optional_label': '（任意）',
    'aicx.achieved_message': 'これで土台はOK',
    'aicx.section1_name': 'あなた・自社',
    'aicx.section1_desc': '何を売っているか。AI が提案の土台にします。',
    'aicx.field_company_product_label': '自社・商材',
    'aicx.field_company_product_placeholder': '例: 製造業向け営業支援SaaS、導入支援込み',
    'aicx.field_company_product_help': '良い例:「製造業向け営業支援SaaS、導入支援込み」',
    'aicx.section2_name': '相手のこと',
    'aicx.section2_desc': '誰に、どんな状況で話すか。提案のトーンが変わります。',
    'aicx.field_target_customer_label': '想定顧客',
    'aicx.field_target_customer_placeholder': '例: 従業員300名以上のB2B企業、営業責任者',
    'aicx.field_target_customer_help': '良い例:「従業員300名以上のB2B企業、営業責任者」',
    'aicx.field_customer_background_label': '顧客背景',
    'aicx.field_customer_background_placeholder': '例: 既存CRMはあるが商談記録が属人化している',
    'aicx.field_customer_background_help':
        '業界・規模・既存の取り組みなど、事前に分かっている前提。相手の課題・予算は商談中にバーが拾うので、推測で埋めなくて大丈夫です。',
    'aicx.section3_name': 'この商談',
    'aicx.section3_desc': '今回のゴールと、避けたいこと。提案の的を絞ります。',
    'aicx.field_meeting_goal_label': '商談ゴール',
    'aicx.field_meeting_goal_placeholder': '例: 現状課題を特定し、次回デモの合意を取る',
    'aicx.field_meeting_goal_help': '良い例:「現状課題を特定し、次回デモの合意を取る」',
    'aicx.field_constraints_label': '制約・禁止事項',
    'aicx.field_constraints_placeholder': '例: 価格断定を避ける。競合名を出しすぎない',
    'aicx.field_constraints_help': 'AI に守らせたい「やってはいけないこと」を書きます。',
    'aicx.section4_name': 'AI への自由指示',
    'aicx.section4_desc': '口調・深掘り方針・社内用語など、上に当てはまらない希望を自由に。',
    'aicx.field_free_instruction_placeholder': '例: 丁寧だが堅すぎない口調で。「御社の課題」より具体的な言葉を促してほしい。',

    // ── ローカル AI ヘルプ (MainView._renderLocalHelp) ──
    'local_ai_help.intro.title': 'Ollama とは？',
    'local_ai_help.intro.body':
        'Ollama は大規模言語モデルをローカル PC で実行できるツールです。すべての処理が端末内で完結し、データが外部に送信されることはありません。',
    'local_ai_help.install.title': 'Ollama をインストール',
    'local_ai_help.install.before_link': '',
    'local_ai_help.install.after_link': ' からダウンロードしてインストールしてください。',
    'local_ai_help.must_run.title': 'セッション開始前に Ollama を起動',
    'local_ai_help.must_run.body':
        'セッションを開始する前に Ollama が起動している必要があります。起動していない場合は、ターミナルで次を実行してください：',
    'local_ai_help.pull.title': 'モデルをダウンロード',
    'local_ai_help.pull.body': '初回利用前にモデルをダウンロードしてください：',
    'local_ai_help.models.title': '推奨モデル',
    'local_ai_help.models.gemma_desc': '4B — 高速、マルチモーダル（画像 + テキスト）',
    'local_ai_help.models.mistral_desc': '8B — テキスト専用、バランスの良い汎用モデル',
    'local_ai_help.models.image_note': 'gemma3:4b 以上は画像対応 — スクリーンショット解析が使えます。',
    'local_ai_help.thinking_warn':
        '「思考型」モデル（deepseek-r1、qwq など）は避けてください。ローカル推論は元々遅く、思考プロセスがあると応答までさらに時間がかかります。',
    'local_ai_help.whisper.title': 'Whisper',
    'local_ai_help.whisper.body': '音声認識用の Whisper モデルは、初回セッション開始時に自動ダウンロードされます。ダウンロードは一度きりです。',
    'local_ai_help.slow.title': 'PC が重い・止まる場合',
    'local_ai_help.slow.body':
        'ローカル実行は RAM と CPU を多く消費します。動作が重くなる場合は LLM の負荷が原因の可能性が高いです。ホスティング型を使いたい場合は BYOK モードに切り替えてください。',
    'local_ai_help.switch_byok_btn': 'BYOK モードに切り替える',

    // ── test-only fixture (referenced by src/i18n/__tests__/index.test.js) ──
    // Mirrors '__test.enOnly' in en.js: a key present only in ja, used to prove
    // that en falls back to ja (not to the raw key).
    '__test.jaOnly': 'ja-only fixture',
};

if (typeof window !== 'undefined') {
    window.WhisperI18nStrings = window.WhisperI18nStrings || {};
    window.WhisperI18nStrings.ja = JA;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = JA;
}
