# Faculty of Computers and Artificial Intelligence — Beni-Suef University

Framework-free Arabic/English website (HTML, CSS, vanilla JavaScript) and a dependency-free Node.js backend using
SQLite. The backend provides student accounts, administrator approval, secure cookie sessions, a dashboard for
requests and complaints, and database-backed website content.

## Run locally

Use Node.js 22.13 or newer (the project uses the built-in `node:sqlite` module):

```powershell
npm start
# open http://127.0.0.1:8080
```

On Windows, double-click `start-site.bat` to start the server if needed and open the admin page. Keep the server
terminal open while using the site; closing it stops the API and causes login to show “Failed to fetch”.

Create the first administrator in a separate terminal:

```powershell
npm run admin:create -- --email admin@fcai.local
```

The command prints a random password once. Save it securely; it cannot be retrieved from the database. Then open
`http://127.0.0.1:8080/#admin` and sign in with that email and password. Public sign-up creates a student account
with `pending` status. An administrator must approve it before the student can sign in.

Set or change the administrator password privately in an interactive local terminal:

```powershell
npm run admin:password -- --email admin@fcai.local
```

The password is not echoed, stored in the source, or passed as a command-line argument. Choose at least 16 characters;
changing it revokes all current sessions.

Run the backend tests with `npm test`.
Container deployment preparation and the launch/privacy checklist are in [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md).
The current implementation, test status, limitations, and deployment blockers are summarized in
[docs/PROJECT-REPORT.md](./docs/PROJECT-REPORT.md).

The SQLite database is created at `backend/data/fcai.sqlite`. JSON files in `backend/data/` are initial seed data:
website content and the three clearly labelled sample complaints are copied to SQLite when the database is first
created. New registrations, user accounts, sessions, and requests are stored in SQLite. No fake registrations are
seeded. Keep the database private and back it up securely.

## Security and deployment

The server binds to `127.0.0.1` by default. Do not expose it directly to the internet. The included Compose setup
keeps it private behind Caddy; production startup requires `TRUST_PROXY=1`. Use a college-controlled domain with
valid DNS for Caddy to issue HTTPS certificates. Provide secure database backups, monitoring, and an operational
account recovery process. Configure `HOST` only when necessary and protect the instance with network controls. Session
cookies are HttpOnly and SameSite=Strict; passwords are stored as scrypt hashes; endpoints enforce server-side roles,
request validation, origin checks, and sign-in rate limits.

Student registrations and submitted messages may contain personal information. Only collect real information after
the site has been approved for that purpose and the hosting environment is properly secured.

## Project structure

- `index.html`, `css/`: site shell and styling.
- `js/`: client views, navigation, content, and authentication/dashboard interface.
- `backend/server.js`: static server and REST API.
- `backend/database.js`: SQLite schema, seed loading, and password hashing.
- `backend/create-admin.js`: one-time first-admin setup command.
- `backend/data/`: JSON seed files; the SQLite database is intentionally ignored by Git.
- `docs/API.md`: API endpoints and account setup.

The JavaScript files are classic scripts that share global scope; keep their load order in `index.html`.
The website's gallery illustrations, faculty profiles, library, announcements, and projects contain sample content,
not verified official records. Faculty names are fictional and use illustrated avatars rather than real portraits.
The “Ask the assistant” widget has been removed.
