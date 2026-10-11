# Деплой и эксплуатация SyToDo

Действующий бот: `app8347651382`, [@SyToDoBot](https://t.me/SyToDoBot).
Mini App: https://app8347651382.tgcloud.ai/.
Репозиторий: https://github.com/marsen5689/SyToDoBot-, ветка `main`.
Последняя проверенная публикация 11 октября 2026: cloud revision 6.
Все текущие таблицы, индексы и две колонки повторений уже применены.

## Первое открытие в другом окружении

Требуется Node.js 22.12+, рекомендуется 24, CLI `@tgcloud/cli` 0.2.0+ из lockfile.
Сначала получить доступ к репозиторию и проверить подключённую GitHub identity.

```bash
git clone https://github.com/marsen5689/SyToDoBot-.git SyToDoBot
cd SyToDoBot
npm ci
git remote -v
git branch -vv
```

Не повторять clone, если checkout уже открыт. Штатную CLI-связь проверяет
`npx tgcloud status`. В новом окружении без связи выполнить `npx tgcloud login`:
пользователь вводит CLI Access безопасным вводом, целевой app ID — 8347651382.
Не хранить токен в исходниках, frontend, документации или shell history.
`.tgcloud/` запрещено читать/редактировать вручную; ей управляет только CLI.
GitHub Actions secret не возвращает исходное значение токена для локального login.

В управляемом окружении сохранить proxy/CA и сетевые настройки. Если Node CLI
нуждается в системном HTTP proxy, выполнять `NODE_USE_ENV_PROXY=1 npx tgcloud ...`.
Не отключать проверку TLS. Ошибку доступа диагностировать через текущую identity
и ответ сервиса, а не через чтение секретных файлов.

## До публикации

```bash
npm run check
# При изменении интерфейса:
npx playwright install chromium
npm run test:ui
npx tgcloud fetch
npx tgcloud status
npx tgcloud diff
npx tgcloud migrate --local --dry-run
git diff --check
```

`npm run check` включает runtime policy, backend-тесты, TypeScript и production build.
Если Chromium уже установлен, можно указать `CHROMIUM_PATH=/usr/bin/chromium`.
Для закрытой сети `TELEGRAM_SDK_PATH=/path/to/telegram-web-app.js` задаёт заранее
полученный официальный SDK в браузерных тестах. Это только тестовая настройка.
Не считать `tgcloud run --ctx` доказательством проверки initData: это инструмент
разработчика, принимающий контекст явно. Production проверяет Telegram.

Пользователь требует согласовывать публичный деплой и изменения облачной базы.
Перед запросом подготовить код, проверки и конкретный schema diff. Если действие
уже разрешено в текущей сессии, повторное согласование не требуется.

## Порядок обновления существующего проекта

У scheduler есть особенность: `tgcloud run` из GitHub загружает код checkout
ветки `main`, а не только последнюю опубликованную cloud revision.
Поэтому новый код с новыми колонками нельзя отправлять в `main` до миграции.

1. Подготовить и проверить новую сборку и schema diff; получить требуемое разрешение.
2. Если нужна **проверенная аддитивная** миграция, выполнить
   `npx tgcloud migrate --local --safe` **до** обновления main и cloud-кода.
   Сравнить применённые операции с согласованными. Если diff требует удалений,
   типов или несовместимых изменений, отдельно подготовить план перехода;
   `--safe` не заменяет такую проверку. При `No schema changes` миграцию не запускать.
3. Закоммитить проверенные исходники и загрузить их в `main` существующего repo:
   `git push origin HEAD:main`. Сохранить gitignored `.tgcloud/`, `.env*`, dist и node_modules.
4. Выполнить `npm run deploy`: build + официальный `tgcloud push`, загружающий
   `tgcloud/` и `dist/` по `tgcloud.jsonc`. На обычное обновление не нужен новый бот.
5. Проверить `npx tgcloud status`, `npx tgcloud migrate --dry-run` и
   `npx tgcloud webhook`. Схема, static и webhook должны быть в sync.
6. Открыть Mini App из Telegram, выполнить нужный пользовательский сценарий.
   После изменения меню отправить боту `/start` или `/menu`.
7. Проверить GitHub dispatcher и обновить handoff / verification фактами публикации.

`push` никогда не мигрирует базу самостоятельно. `static.source` — `dist`,
SPA включена; `/assets/*` immutable. HTML и все файлы сборки проверять по HTTP,
при необходимости сравнивать SHA-256 с dist. Webhook для `message` и
`callback_query` поддерживает CLI. `webhook sync` нужен только при обнаруженном
расхождении; не заменять webhook вручную вызовом Bot API.

Собственная Git identity/credentials могут отличаться в новом окружении.
Использовать уже настроенную авторизацию, не брать токены из документов.

## Планировщик и его проверка

Файл: `.github/workflows/task-reminders.yml`, cron `2-59/5 * * * *`.
Node 24, `npm ci --ignore-scripts`, runner `scripts/run-reminders.mjs`,
secret `TGCLOUD_TOKEN` для того же app. Значение секрета не включать в логи.
`tgcloud/lib/reminder-config.js`: `remindersEnabled=true`.

Если доступен авторизованный GitHub CLI:

```bash
# Только проверить CLI-доступ, без отправки:
gh workflow run task-reminders.yml --repo marsen5689/SyToDoBot- --ref main -f verify_only=true
gh run list --repo marsen5689/SyToDoBot- --workflow task-reminders.yml --limit 5
# После согласованной публикации проверить обработчик: он отправляет ожидающие уведомления.
gh workflow run task-reminders.yml --repo marsen5689/SyToDoBot- --ref main -f verify_only=false
```

То же доступно в GitHub → Actions → Telegram task reminders → Run workflow.
Для локального согласованного запуска worker: `npm run reminders` (реальная отправка).
Worker исполняется в Telegram, Node-процесс только запускает CLI. Служебный
root ctx maintenanceJob находится в runner; клиентский payload доступа не даёт.

Успех: job success, `enabled:true`, `failed:0`; `sent:0` допустимо, если нет
ожидающих уведомлений. Ручной workflow_dispatch проверяет работоспособность
dispatcher, но не подтверждает получение конкретным пользователем или запуск
события schedule. Для проверки доставки пользователь создаёт реальное напоминание
и подтверждает сообщение; не создавать фиктивные production-записи вместо этого.

GitHub может задерживать cron, а публичные workflows могут отключаться после
60 дней отсутствия активности. Проверять Actions при отсутствии сообщений.
У blocked/deactivated пользователя worker приостанавливает отправку; для
возобновления пользователь должен разблокировать бот и изменить расписание.
При rate limit/сетевой ошибке действует lease и последующая попытка.

## Где искать проблему

- Нет новых UI-элементов: переоткрыть Mini App, сверить опубликованный HTML/assets с dist.
- Бот не отвечает: webhook/allowed_updates через CLI, корректные handlers,
  затем `/start` в личном чате; убедиться, что работает именно SyToDoBot.
- Не приходят уведомления: enabled, GitHub job/secret, будущее время и интервал,
  разрешение сообщений, бот не заблокирован, ожидание ближайшей проверки.
- Server error после обновления: schema diff/sync, применена ли согласованная миграция.
- 401: открыть заново из Telegram и проверить официальный Serverless.call;
  не обходить авторизацию и не доверять initDataUnsafe/userId из body.

Последние результаты и конкретные job URLs: [verification.md](verification.md).
