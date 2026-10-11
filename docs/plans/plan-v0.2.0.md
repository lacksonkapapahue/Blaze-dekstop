# Desktop Batch 2 plan (v0.2.0)
01 · Command menu above the chat box

Typing / opens a floating list above the box. Each command has a one-line description. The list filters as you type. Arrow keys, Enter/Tab or a click picks one.
A + button on the box opens the same menu, so nobody has to know about /.
Commands: /new, /model (see or switch the model), /project, /folder, /retry, /stop, /clear, /jobs, /schedule, /doctor, /settings, /theme, /auto-approve, /memory, /skills.
@ opens a file picker from the project, which attaches that file to your message.
02 · Projects

New PROJECTS section in the sidebar. A project is a name, a folder, its own chats and its own instructions that Blaze always follows there.
+ New project: pick a folder and the name fills in from it.
Project page: its chats, an instructions box, git branch and status, recently changed files, and a New chat button.
Switching project switches the folder and filters the chat list. Chats with no project go under General.
The /project command and the folder chip at the top both switch projects.
03 · Fixes

Commands run in the app and never go to the model as text. Chat titles skip them.
Blaze names the real provider and model it's on, and never claims to be GPT-4 or anything else.
The model chip at the top shows which model answered.

Batch 2 addition: Work and Design tabs
04 · Two tabs at the top: WORK and DESIGN

Work is today's chat: code, commands, files.
Design opens when a task turns visual. Blaze spots it from the request ("make a landing page", "redesign the settings screen") or from the files it writes (.html, .css, .svg, components).
Switching follows a setting: Ask first (default, a card saying "Open in Design?"), Always, or Never.
05 · Live preview

Big preview pane with Desktop, Tablet and Phone widths, plus light and dark.
It previews HTML files, SVG and images, and a running dev server (Vite, Next, etc.), which Blaze starts for you.
Open pops the preview out to full window or your browser.
06 · Step-by-step versions

Every change the model makes is saved as a numbered version (01, 02, 03…) in a filmstrip, each with a thumbnail and one line on what changed.
Click any version to view it. Compare two side by side, or Restore one.
For new designs, Blaze can suggest 2–3 directions first. You pick one, then it builds it out step by step.
07 · Edit with AI by pointing

Select mode: hover to outline elements, click to pick one, Shift-click to pick several.
A small bar pops up on the selection with Change, Remove, Restyle, Replace text and Ask… (free text, e.g. "make this a 3-column grid").
Blaze gets the exact element and its code, edits only that part, and saves a new version.
Quick tweaks: drag a colour or spacing value on the selected element to preview it, then Apply writes it into the code.
Design chat sits beside the preview, so you can still just type.

