// Unit test for the plain-words describer (frontend/dist/steps.js). Run: node ci/steps.test.js
const S = require("../frontend/dist/steps.js");
const sh = cmd => S.describe("run_shell", JSON.stringify({ command: cmd }));
const cases = [
  // The bug report: a compound command reads as its main intent.
  ["cat ~/Projects/blaze/package.json; echo ===; ls ~/Projects/blaze", "Reading package.json"],
  ["cat README.md", "Reading README.md"],
  ["less /var/log/syslog", "Reading syslog"],
  ["head -n 50 src/app.go", "Reading app.go"],
  ["cat a.md && cat b.md", "Reading a.md and b.md"],
  ["ls -la", "Looking through the project folder"],
  ["ls ~/Projects/blaze/frontend", "Looking through frontend"],
  ["ls ~", "Looking through your home folder"],
  ["tree -L 2 src", "Looking through src"],
  ["find . -name '*.go' | head", "Looking for the .go files in the project folder"],
  ["grep -rn \"TODO\" src", 'Searching for "TODO"'],
  ["rg -i useState --type ts", 'Searching for "useState"'],
  ["cat server.log | grep -i error | tail -20", "Reading server.log"],
  ["git status", "Checking git status"],
  ["git log --oneline -10", "Checking git history"],
  ["git add -A && git commit -m 'fix: price rounding'", "Committing changes"],
  ["git push origin plain-steps", "Pushing changes"],
  ["git clone https://github.com/user/homeglow.git", "Cloning homeglow"],
  ["npm install", "Installing dependencies"],
  ["cd frontend && pnpm i", "Installing dependencies"],
  ["pip install -r requirements.txt", "Installing dependencies"],
  ["go mod download", "Installing dependencies"],
  ["cargo add serde", "Installing dependencies"],
  ["sudo pacman -S --noconfirm ffmpeg", "Installing ffmpeg"],
  ["npm test", "Running the tests"],
  ["go test ./...", "Running the tests"],
  ["python -m pytest -q tests/", "Running the tests"],
  ["CI=1 npx vitest run", "Running the tests"],
  ["npm run build 2>&1 | tail -30", "Building the project"],
  ["GOOS=windows go build -o blaze.exe .", "Building the project"],
  ["make", "Building the project"],
  ["docker build -t blaze .", "Building a Docker image"],
  ["curl -s https://api.github.com/repos/x/y | jq .stargazers_count", "Fetching api.github.com"],
  ["wget https://example.com/file.zip", "Downloading from example.com"],
  ["pnpm dev", "Starting the dev server"],
  ["python3 scripts/seed.py --count 40", "Running seed.py"],
  ["node -e \"console.log(process.version)\"", "Running a quick script"],
  ["node --version", "Checking the node version"],
  ["which ffmpeg", "Checking ffmpeg is installed"],
  ["df -h", "Checking disk space"],
  ["ps aux | grep node", "Checking running programs"],
  ["mkdir -p src/components", "Creating components"],
  ["rm -rf node_modules", "Deleting node_modules"],
  ["sed -i 's/foo/bar/g' config.yaml", "Editing config.yaml"],
  ["echo 'PORT=3000' >> .env.local", "Writing .env.local"],
  ["cat > notes.md <<'EOF'\n# Notes\nrm -rf /\nEOF", "Writing notes.md"],
  ["docker compose up -d", "Starting the containers"],
  ["echo hello", "Running a command"],
  ["frobnicate --all", "Running a command"],
  ["cd ~/Projects/blaze", "Opening blaze"],
];
const tools = [
  [["file_read", '{"path":"/home/luke/code/homeglow/src/index.html"}'], "Reading index.html"],
  [["file_edit", '{"path":"app.go"}'], "Editing app.go"],
  [["file_list", '{"path":"."}'], "Looking through the project folder"],
  [["web_search", '{"query":"wails v2 tray icon"}'], 'Searching the web for "wails v2 tray icon"'],
  [["fetch_page", '{"url":"https://www.example.com/a"}'], "Reading example.com"],
  [["git", '{"args":"diff --stat"}'], "Checking what changed"],
  [["gmail_search", '{"q":"from:gloria"}'], "Searching your email"],
  [["connector_tools", '{"group":"mcp:linear"}'], "Getting Linear ready"],
  [["mcp_linear_list_issues", "{}"], "Using Linear: list issues"],
  [["read_screen", "{}"], "Reading your screen"],
  [["mystery_tool", "{}"], "Using mystery tool"],
  [["run_shell", '{"command":"frobnicate --all","summary":"Tidying the downloads folder"}'], "Tidying the downloads folder"],
  [["run_shell", '{"command":"frobnicate","summary":"rm -rf ~/x; echo"}'], "Running a command"],
  [["run_shell", '{"command":"cat package.json","summary":"Deleting everything"}'], "Reading package.json"],
  [["run_shell", "not json"], "Running a command"],
];
const status = [
  ["Running: cat ~/Projects/blaze/package.json; echo ===; ls ~/", "Reading package.json"],
  ["git log --oneline", "Checking git history"],
  ["pip install requests", "Installing dependencies"],
  ["Searching: vite slow build", 'Searching the web for "vite slow build"'],
  ["Google Gemini is cooling down, back in 30s", "Google Gemini is cooling down, back in 30s"],
  ["Wrote /home/luke/code/x/index.html", "Writing index.html"],
  ["some {json: 1}", ""],
];
let fail = 0, n = 0;
const check = (label, got, want) => { n++; if (got !== want) { fail++; console.error(`FAIL ${label}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); } };
cases.forEach(([c, w]) => check(c, sh(c), w));
tools.forEach(([[name, a], w]) => check(name + " " + a, S.describe(name, a), w));
status.forEach(([l, w]) => check("status " + l, S.plainStatus(l), w));
// Nothing a user sees while working may look like a command.
cases.concat(tools.map(t => [t[0][1]])).forEach(([c]) => {
  const d = c.startsWith("{") || c === "not json" ? "" : sh(c);
  if (d && (d.length > 60 || /[;|&$~{}]|\/\w/.test(d))) { fail++; console.error("NOT PLAIN:", c, "→", d); }
});
check("detail shell", S.detail("run_shell", '{"command":"ls -la ~"}'), "ls -la ~");
check("detail tool", S.detail("file_read", '{"path":"a.txt"}'), 'file_read {\n  "path": "a.txt"\n}');
check("worked", S.workedLine(6, 14.2), "Worked · 6 steps · 14s");
check("worked saved", S.workedLine(1, null), "Worked · 1 step");
check("worked long", S.workedLine(3, 125), "Worked · 3 steps · 2m 5s");
console.log(`${n - fail}/${n} passed (${cases.length} shell commands)`);
process.exit(fail ? 1 : 0);
