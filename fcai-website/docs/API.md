# Backend API

The dependency-free Node.js server serves the website and same-origin API together. Node.js 22.13 or newer is
required for its built-in SQLite support. Start it with `npm start`; run `npm test` for the backend tests.

The database lives at `backend/data/fcai.sqlite`. Initial content and the three labelled sample complaints are
seeded from `backend/data/*.json` when the database is first created. Registration and request tables start empty.
The JSON files are not the live store after initialization.

## Administrator setup and dashboard

Create the first admin account locally:

```powershell
npm run admin:create -- --email admin@fcai.local
```

The command generates a strong random password and prints it once. Keep it private. There is no default or
hard-coded admin password. Open `http://127.0.0.1:8080/#admin` to sign in. The dashboard lists student accounts,
training/contact requests, complaints, and suggestions; admins can approve/block student accounts and update
request statuses. Admins can also read and replace supported site-content collections via the API.

To set a chosen password or rotate it later, use an interactive local terminal:

```powershell
npm run admin:password -- --email admin@fcai.local
```

The password is entered without being echoed or placed in shell history. It must be 16–128 characters. Password
changes revoke existing sessions.

| Method + path | Access | Purpose |
|---|---|---|
| `GET /api/v1/health` | Public | Health status |
| `POST /api/v1/auth/register` | Public | Create a pending student account |
| `POST /api/v1/auth/login` | Public | Sign in; sets an HttpOnly, SameSite session cookie |
| `GET /api/v1/auth/me` | Signed-in user | Return the current account |
| `POST /api/v1/auth/logout` | Public | Revoke the current session cookie |
| `GET /api/v1/admin/users` | Admin | List accounts |
| `PATCH /api/v1/admin/users/:id` | Admin | Set student status to `pending`, `active`, or `blocked` |
| `GET /api/v1/admin/submissions` | Admin | List training and contact requests |
| `PATCH /api/v1/admin/submissions/:id` | Admin | Set request status to `new`, `in_progress`, or `resolved` |
| `GET /api/v1/admin/complaints` | Admin | List complaints and suggestions |
| `PATCH /api/v1/admin/complaints/:id` | Admin | Update complaint/suggestion status |
| `GET /api/v1/admin/content` | Admin | Read all editable content collections |
| `PUT /api/v1/admin/content/:key` | Admin | Replace one collection (`news`, `projects`, `library`, `gallery`, or `timetables`) |
| `GET /api/v1/student/submissions` | Active student | List requests matching the signed-in student's email |
| `POST /api/v1/complaints` | Public | Submit a complaint or suggestion |
| `POST /api/v1/registrations` | Public | Submit a training or contact request |
| `GET /api/v1/news`, `/projects`, `/library`, `/gallery`, `/timetables` | Public | Read site content from SQLite |

Student registration accepts `name`, `email`, `studentId`, `department`, and `password` (at least 12 characters).
It always creates a `student` with `pending` status. Public requests accept a type, name, email, message (10–2000
characters), and optional student ID/department. Every API error returns JSON with an `error` field.

All authenticated API requests use the HttpOnly session cookie; bearer tokens are not issued or stored in browser
JavaScript. Sessions expire after eight hours. Passwords are hashed with Node.js `scrypt`; sign-in attempts are
rate-limited; mutation endpoints validate the request Origin when supplied. Admin authorization is checked on every
request. Admin accounts cannot be created through public registration.

## Security / production

The server binds to `127.0.0.1` by default. Do not expose the HTTP listener directly to the internet. Use a properly
configured HTTPS reverse proxy (set `TRUST_PROXY=1` only behind that trusted proxy) and secure backups before storing real personal data. The application sets security
headers for static pages and does not enable cross-origin API access. Production operations still need a secure
admin recovery process and appropriate monitoring.

The repository includes a container build and local-only port binding in `compose.yaml`. See
[`DEPLOYMENT.md`](./DEPLOYMENT.md) for the deployment procedure, privacy/content approvals, and pre-launch checks.
This preparation is not proof of deployment or performance on the college's infrastructure.

## Content data shapes

The seeded JSON files retain the site's existing shapes:

- `news`, `projects`, and `library`: arrays of content objects.
- `gallery`: array of `[imageKey, titleEnglish, titleArabic]`. It contains original SVG illustrations for the campus,
  lecture auditorium, computer lab, and classroom; these are not photographs of the actual faculty.
- `timetables`: timetable object.

`PUT /api/v1/admin/content/:key` expects `{ "value": <array-or-object> }`. Content is escaped by the dashboard when
displayed, but validate any content before publishing it. The faculty directory also contains clearly labelled
fictional names and illustrated avatars; remove or replace those with faculty-approved records before presenting
the site as official. Sample library records do not include downloadable files.
