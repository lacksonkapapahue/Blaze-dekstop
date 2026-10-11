# Screenshots of the UI with a fake backend, pushed to the `shots` branch by CI.
import pathlib, sys
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).resolve().parent.parent
out = root / "shots"; out.mkdir(exist_ok=True)
mock = (root / "ci" / "mock.js").read_text()
url = (root / "frontend" / "dist" / "index.html").as_uri()
sample = (root / "ci" / "sample").as_uri()
allerrs = []
with sync_playwright() as p:
    b = p.chromium.launch(**({"executable_path": __import__("os").environ["CHROME"]} if __import__("os").environ.get("CHROME") else {}))
    for theme in ["light", "dark"]:
        pg = b.new_page(viewport={"width": 1280, "height": 820}, device_scale_factor=1)
        pg.add_init_script(f"window.__theme='{theme}';window.__sample='{sample}';" + mock)
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(url); pg.wait_for_timeout(600)
        pg.screenshot(path=str(out / f"home-{theme}.png"))
        pg.evaluate("loadConv(window.__conv); show('work')"); pg.wait_for_timeout(300)
        pg.screenshot(path=str(out / f"chat-{theme}.png"))
        pg.evaluate("document.querySelector('#input').value='/'; onType()"); pg.wait_for_timeout(300)
        pg.screenshot(path=str(out / f"menu-{theme}.png"))
        pg.evaluate("closeMenu(); document.querySelector('#input').value='@hero'; onType()"); pg.wait_for_timeout(300)
        pg.screenshot(path=str(out / f"files-{theme}.png"))
        pg.evaluate("closeMenu(); document.querySelector('#input').value=''; show('project','p1')"); pg.wait_for_timeout(400)
        pg.screenshot(path=str(out / f"project-{theme}.png"))
        pg.evaluate("show('design')"); pg.wait_for_timeout(1200)
        pg.screenshot(path=str(out / f"design-{theme}.png"))
        pg.evaluate("""selectOn=true; drawStage(); window.postMessage({blaze:'selected', items:[{selector:'section.hero > h1', tag:'h1', text:'Warm light for every corner of home.', html:'<h1>Warm light</h1>', styles:{color:'rgb(27,27,27)', background:'rgba(0,0,0,0)', fontSize:'54px', padding:'0px', borderRadius:'0px'}}]}, '*')"""); pg.wait_for_timeout(500)
        pg.evaluate("document.querySelector('.sbacts [data-a=Restyle]').click()"); pg.wait_for_timeout(200)
        pg.screenshot(path=str(out / f"design-select-{theme}.png"))
        pg.evaluate("show('work'); document.querySelector('#route').click()"); pg.wait_for_timeout(400)
        pg.evaluate("document.querySelectorAll('.pop .opt')[1].click()"); pg.wait_for_timeout(400)
        pg.screenshot(path=str(out / f"model-picker-{theme}.png"))
        pg.evaluate("""closePop(); sendText('Make the hero section blue', []);
          fire('route', {route: 'Google Gemini · gemini-3.8-flash'});
          for (let i = 0; i < 8; i++) { fire('tool', {id: 'x'+i, name: i < 2 ? 'file_read' : 'file_edit', args: '{"path":"index.html"}'});
            fire('tool_done', {id: 'x'+i, result: i < 3 ? 'Read index.html (120 lines)' : "Error in file_edit: the arguments weren't valid JSON (unexpected end of JSON input). Call it again with a JSON object."}); }
          fire('repair', {dropped: ['a call with no tool name'], repairs: []});
          fire('error', {message: "Google Gemini refused the conversation's format (Request contains an invalid argument.). Blaze repaired the history; try again, or switch model.", detail: 'No model could answer:\\n- Google Gemini: HTTP 400: Request contains an invalid argument.', kind: 'model', failures: []});""")
        pg.wait_for_timeout(300)
        pg.screenshot(path=str(out / f"error-{theme}.png"))
        # v0.4: hidden tool steps. Mid-turn shimmer status line, then the quiet "Worked for 12s".
        pg.evaluate("newChat()"); pg.wait_for_timeout(300)
        pg.evaluate("""sendText('Find out why the build is slow and fix it', []);
          fire('route', {route: 'Google Gemini · gemini-3.8-flash'});
          fire('tool', {id: 'w1', name: 'file_read', args: '{"path":"vite.config.ts"}'});
          fire('tool_done', {id: 'w1', result: 'Read vite.config.ts (40 lines)'});
          fire('tool', {id: 'w2', name: 'web_search', args: '{"query":"vite slow build sourcemaps"}'});""")
        pg.wait_for_timeout(700)
        pg.screenshot(path=str(out / f"working-{theme}.png"))
        pg.evaluate("""fire('tool_done', {id: 'w2', result: '5 results'});
          fire('tool', {id: 'w3', name: 'file_edit', args: '{"path":"vite.config.ts"}'});
          fire('tool_done', {id: 'w3', result: 'Edited vite.config.ts (1 replacement).'});
          fire('tool', {id: 'w4', name: 'run_shell', args: '{"command":"pnpm build"}'});
          fire('tool_done', {id: 'w4', result: 'exit 0 · built in 9.8s'});
          fire('delta', 'The build was making **full source maps** for production. I switched them to `hidden`, and `pnpm build` now takes **9.8s** instead of 41s.');
          fire('done', {route: 'Google Gemini · gemini-3.8-flash', seconds: 12.2});""")
        pg.wait_for_timeout(400)
        pg.screenshot(path=str(out / f"worked-{theme}.png"))
        pg.evaluate("document.querySelector('.work.done').click()"); pg.wait_for_timeout(300)
        pg.screenshot(path=str(out / f"worked-open-{theme}.png"))
        # v0.4.6: plain-words steps. Live: only plain words (the backend's raw "Running: …" status is
        # translated); done: one "Worked · 6 steps · 14s" line; expanded: each step's exact command and output.
        def steps_turn(pg, tag, size):
            pg.evaluate("""newChat().then(() => { sendText('Why is the build slow? Fix it and run the tests.', []);
              fire('route', {route: 'Google Gemini · gemini-3.8-flash'});
              const T = window.__stepsTurn;
              T.slice(0, 3).forEach((t, i) => { fire('tool', {id: 'p' + i, name: t.name, args: JSON.stringify(t.args)}); fire('tool_done', {id: 'p' + i, result: t.result}); });
              fire('tool', {id: 'p3', name: T[3].name, args: JSON.stringify(T[3].args)}); fire('tool_done', {id: 'p3', result: T[3].result});
              fire('tool', {id: 'p4', name: T[4].name, args: JSON.stringify(T[4].args)});
              fire('status', 'Running: ' + T[4].args.command); })""")
            pg.wait_for_timeout(800)
            pg.screenshot(path=str(out / f"steps-{tag}live-{theme}.png"))
            live = pg.evaluate("document.querySelector('.work.live .wt').textContent")
            if live.strip() != "Running the tests" or any(c in live for c in "~;|$/"):
                errs.append("live step line is not plain words: " + repr(live))
            pg.evaluate("""const T = window.__stepsTurn;
              fire('tool_done', {id: 'p4', result: T[4].result});
              fire('tool', {id: 'p5', name: T[5].name, args: JSON.stringify(T[5].args)}); fire('tool_done', {id: 'p5', result: T[5].result});
              fire('delta', 'Production builds were writing **full source maps**. I set `build.sourcemap` to `hidden`; `pnpm build` now takes **9.8s** instead of 41s. One test still fails on float rounding in `price.ts`.');
              fire('done', {route: 'Google Gemini · gemini-3.8-flash', seconds: 14.2});""")
            pg.wait_for_timeout(500)
            pg.screenshot(path=str(out / f"steps-{tag}collapsed-{theme}.png"))
            line = pg.evaluate("[...document.querySelectorAll('.msg.blaze')].pop().querySelector('.work.done').textContent.trim()")
            if line != "Worked · 6 steps · 14s":
                errs.append("collapsed line: " + repr(line))
            pg.evaluate("""const m = [...document.querySelectorAll('.msg.blaze')].pop(); m.querySelector('.work.done').click();
              const rows = m.querySelectorAll('.step'); rows[0].querySelector('.head').click(); rows[4].querySelector('.head').click();""")
            pg.wait_for_timeout(400)
            pg.evaluate("[...document.querySelectorAll('.msg.blaze')].pop().querySelector('.work').scrollIntoView({block: 'start'})"); pg.wait_for_timeout(200)
            pg.screenshot(path=str(out / f"steps-{tag}expanded-{theme}.png"))
            cmd = pg.evaluate("[...document.querySelectorAll('.msg.blaze')].pop().querySelector('.step .cmd').textContent")
            if not cmd.startswith("cat ~/Projects/blaze/package.json"):
                errs.append("expanded step lost its exact command: " + repr(cmd))
        steps_turn(pg, "", None)
        # v0.4.7: background agents. Dispatch, then keep chatting while the agent works.
        pg.evaluate("newChat()"); pg.wait_for_timeout(300)
        pg.evaluate("""sendText('Fix the failing build and get the tests green. I will keep working on the hero copy.', []);
          fire('turn', {kind: 'user', conv: 'c7'});
          fire('route', {route: 'Google Gemini · gemini-3.8-flash'});
          fire('tool', {id: 'd1', name: 'dispatch_agent', args: '{"handle":"fix-build","task":"Fix the HomeGlow build"}'});
          fire('agent', {handle: 'fix-build', conv: 'c7', task: 'Fix the failing HomeGlow build (pnpm build), then run pnpm test and make sure all tests pass. Report what was wrong.', status: 'running', now: 'Starting', n: 0, started: Date.now() - 1000, seconds: 1});
          fire('tool_done', {id: 'd1', result: 'started: agent "fix-build" is working in the background.'});
          fire('delta', "On it. A background agent is fixing the build; I'll report back when it's green.");
          fire('done', {route: 'Google Gemini · gemini-3.8-flash', seconds: 1.4, handoff: true});
          window.__agentSteps.slice(0, 3).forEach(s => fire('agent_step', {handle: 'fix-build', step: s}));
          fire('agent_step', {handle: 'fix-build', step: {...window.__agentSteps[3], done: false, result: ''}});
          fire('agent', {handle: 'fix-build', conv: 'c7', status: 'running', now: 'Editing hero.liquid', n: 4, started: Date.now() - 42000, seconds: 42});
          sendText('While that runs: give me three punchier headlines for the hero.', []);
          fire('turn', {kind: 'user', conv: 'c7'});
          fire('delta', '1. **Light that feels like home.**\\n2. **Warm corners, every evening.**\\n3. **Glow, without the glare.**\\n\\nI like the first: short, and it says what you sell.');
          fire('done', {route: 'Google Gemini · gemini-3.8-flash', seconds: 2.1});""")
        pg.wait_for_timeout(500)
        pg.screenshot(path=str(out / f"agent-running-{theme}.png"))
        if pg.evaluate("document.querySelectorAll('.agcard.running').length") != 1:
            errs.append("running agent card missing")
        if pg.evaluate("document.querySelector('.agcard .ag-now').textContent.trim()") != "Editing hero.liquid":
            errs.append("agent card does not show the plain step")
        # An approval from the agent shows on its card, not in the main chat.
        pg.evaluate("""fire('confirm', {id: 'k9', agent: 'fix-build', title: 'Run this command?', detail: 'pnpm add -D vite@6'});""")
        pg.wait_for_timeout(300)
        pg.evaluate("document.querySelector('.agcard').scrollIntoView({block: 'center'})"); pg.wait_for_timeout(150)
        pg.screenshot(path=str(out / f"agent-approval-{theme}.png"))
        if not pg.evaluate("!!document.querySelector('.agcard .ag-ask .ag-q')"):
            errs.append("agent approval did not land on its card")
        pg.evaluate("document.querySelector('.agcard .ag-q .yes').click()")
        # It finishes: the card collapses and its result wakes the main agent.
        pg.evaluate("""fire('agent', {handle: 'fix-build', conv: 'c7', status: 'done', now: '', n: 6, steps: window.__agentSteps, started: Date.now() - 95000, ended: Date.now(), seconds: 95,
            result: 'The build broke because `sections/hero.liquid` imported `./hero.css`, but the file is `assets/Hero.css` (capital H). Linux is case-sensitive, so the build failed there.\\n\\n- Fixed the import in `sections/hero.liquid`.\\n- `pnpm build` passes (9.8s).\\n- `pnpm test`: **42 passed**.'});
          fire('turn', {kind: 'agent', handle: 'fix-build', conv: 'c7'});
          fire('delta', 'The build is **green again**. The hero imported `./hero.css` but the file is `Hero.css`, and Linux cares about the capital. Fixed, and all **42 tests pass**.');
          fire('done', {route: 'Google Gemini · gemini-3.8-flash', seconds: 1.9});""")
        pg.wait_for_timeout(500)
        pg.screenshot(path=str(out / f"agent-done-{theme}.png"))
        if pg.evaluate("document.querySelector('.agcard .ag-now').textContent.trim()") != "Done · 6 steps":
            errs.append("finished agent card did not collapse to Done · 6 steps")
        pg.evaluate("document.querySelector('.agcard .ag-now').click()"); pg.wait_for_timeout(300)
        pg.evaluate("document.querySelector('.agcard').scrollIntoView({block: 'start'})"); pg.wait_for_timeout(150)
        pg.screenshot(path=str(out / f"agent-expanded-{theme}.png"))
        if pg.evaluate("document.querySelectorAll('.agcard.open .ag-log .step').length") != 6:
            errs.append("expanded agent card does not list its 6 steps")
        # A saved chat after a restart: the agent shows as interrupted with Resume / Discard.
        pg.evaluate("loadConv(window.__agentConv)"); pg.wait_for_timeout(400)
        pg.screenshot(path=str(out / f"agent-interrupted-{theme}.png"))
        if not pg.evaluate("!!document.querySelector('.agcard.interrupted .ag-acts .btn.accent')"):
            errs.append("interrupted agent card has no Resume button")
        # v0.4.2: AI chat titles. Mid-typewriter, then settled; rename on double-click.
        pg.evaluate("fire('title', {id: 'c2', title: 'Postgres Container For HomeGlow', source: 'auto'})"); pg.wait_for_timeout(560)
        pg.screenshot(path=str(out / f"titles-typing-{theme}.png"))
        pg.evaluate("fire('title', {id: 'c3', title: 'Laptop Fan Noise And Heat', source: 'auto'})"); pg.wait_for_timeout(2000)
        pg.screenshot(path=str(out / f"titles-{theme}.png"))
        t2 = pg.evaluate("document.querySelector('#chats .chat[data-id=c2] .t').textContent")
        if t2 != "Postgres Container For HomeGlow":
            errs.append("title event did not update the sidebar: " + repr(t2))
        pg.dblclick("#chats .chat[data-id=c3] .t"); pg.wait_for_timeout(200)
        pg.screenshot(path=str(out / f"rename-{theme}.png"))
        if not pg.evaluate("!!document.querySelector('#chats input.rename')"):
            errs.append("double-click did not start renaming")
        pg.keyboard.press("Escape"); pg.wait_for_timeout(100)
        # v0.4.2: mini particle-orb marks, zoomed 3x: a saved reply (frozen) and a live turn.
        zp = b.new_page(viewport={"width": 860, "height": 560}, device_scale_factor=3)
        zp.add_init_script(f"window.__theme='{theme}';window.__sample='{sample}';" + mock)
        zp.on("pageerror", lambda e: errs.append(str(e)))
        zp.goto(url); zp.wait_for_timeout(600)
        zp.evaluate("loadConv(window.__conv); show('work')"); zp.wait_for_timeout(300)
        zp.evaluate("document.querySelector('.work.done').click(); document.querySelector('#log').scrollTop = 0"); zp.wait_for_timeout(300)
        zp.locator(".msg.blaze").first.screenshot(path=str(out / f"marks-{theme}.png"))
        if zp.evaluate("document.querySelectorAll('.msg.blaze canvas.morb').length") < 3:
            errs.append("mini orb marks missing")
        zp.evaluate("""newChat().then(() => { sendText('Remember that my name is Luke', []);
          fire('tool', {id: 'm1', name: 'remember', args: '{"fact":"Name is Luke"}'}); fire('tool_done', {id: 'm1', result: 'Remembered.'});
          fire('tool', {id: 'm2', name: 'file_read', args: '{"path":"notes.md"}'}); document.querySelector('.work').click(); })""")
        zp.wait_for_timeout(700)
        zp.locator(".msg.blaze").first.screenshot(path=str(out / f"marks-live-{theme}.png"))
        zp.close()
        # v0.4.1: answer cards. A saved chat whose long table sits in a collapsed card above the short answer.
        pg.evaluate("loadConv(window.__cardConv); show('work')"); pg.wait_for_timeout(500)
        pg.evaluate("document.querySelector('#log').scrollTop = 0"); pg.wait_for_timeout(200)
        pg.screenshot(path=str(out / f"card-collapsed-{theme}.png"))
        pg.evaluate("document.querySelector('.acard .atog').click()"); pg.wait_for_timeout(700)
        pg.evaluate("document.querySelector('.acard').scrollIntoView({block: 'start'})"); pg.wait_for_timeout(200)
        pg.screenshot(path=str(out / f"card-expanded-{theme}.png"))
        pg.evaluate("document.querySelector('#log').scrollTop = 1e6"); pg.wait_for_timeout(200)
        pg.screenshot(path=str(out / f"card-expanded-end-{theme}.png"))
        # Streaming: an open :::card block fills its card live.
        pg.evaluate("newChat()"); pg.wait_for_timeout(300)
        pg.evaluate("""sendText('Compare the roadmap phases', []);
          fire('route', {route: 'Google Gemini · gemini-3.8-flash'});
          fire('delta', 'Blaze Desktop is roughly **a third of the way to 1.0**.\\n\\n:::card Roadmap\\n' + window.__roadmap.split('\\n').slice(0, 5).join('\\n'));""")
        pg.wait_for_timeout(400)
        pg.screenshot(path=str(out / f"card-streaming-{theme}.png"))
        pg.evaluate("""fire('delta', '\\n' + window.__roadmap.split('\\n').slice(5).join('\\n') + '\\n:::\\n');
          fire('done', {route: 'Google Gemini · gemini-3.8-flash', seconds: 4.1});""")
        pg.wait_for_timeout(300)
        # Fallback: a long reply without card markers folds on "done".
        pg.evaluate("newChat()"); pg.wait_for_timeout(300)
        pg.evaluate("""sendText('Set up a Postgres container for HomeGlow', []);
          fire('route', {route: 'Google Gemini · gemini-3.8-flash'});
          fire('delta', window.__autoReply); fire('done', {route: 'Google Gemini · gemini-3.8-flash', seconds: 6.3});""")
        pg.wait_for_timeout(500)
        pg.screenshot(path=str(out / f"card-auto-{theme}.png"))
        n = pg.evaluate("document.querySelectorAll('.acard.tall').length + document.querySelectorAll('.acard.fits').length")
        if n < 1:
            errs.append("fallback reply did not fold into a card")
        # v0.5 composer: + menu, attachments (images, files, a folder), vision fallback, voice, modes.
        pg.evaluate("newChat()"); pg.wait_for_timeout(300)
        pg.evaluate("openMenu('plus', plusItems(), 'Attach')"); pg.wait_for_timeout(250)
        pg.screenshot(path=str(out / f"composer-plus-{theme}.png"))
        pg.evaluate("""closeMenu(); addAttach(Object.values(window.__att));
          document.querySelector('#input').value = 'Why does the hero break on phones? The brief and the sections are attached.'; grow();""")
        pg.wait_for_timeout(300)
        pg.screenshot(path=str(out / f"composer-attachments-{theme}.png"))
        n = pg.evaluate("document.querySelectorAll('#attach .achip').length")
        if n != 5:
            errs.append(f"expected 5 attachment chips, got {n}")
        pg.evaluate("document.querySelector('#attach .achip .ax').click()"); pg.wait_for_timeout(100)
        if pg.evaluate("document.querySelectorAll('#attach .achip').length") != 4:
            errs.append("removing a chip didn't work")
        pg.evaluate("S.vision_model = ''; drawAttach()"); pg.wait_for_timeout(200)
        pg.screenshot(path=str(out / f"composer-novision-{theme}.png"))
        if not pg.evaluate("document.querySelector('#visionwarn').style.display !== 'none'"):
            errs.append("no vision warning without a vision model")
        pg.evaluate("S.vision_model = 'Google Gemini · gemini-3.8-flash'; submit()"); pg.wait_for_timeout(200)
        pg.evaluate("""fire('route', {route: 'Google Gemini · gemini-3.8-flash'});
          fire('delta', 'The hero image is a fixed **1440px** wide, so phones scroll sideways. I set it to `max-width: 100%` in `sections/hero.liquid`.');
          fire('done', {route: 'Google Gemini · gemini-3.8-flash', seconds: 5.2});""")
        pg.wait_for_timeout(300)
        pg.screenshot(path=str(out / f"chat-attachments-{theme}.png"))
        if pg.evaluate("document.querySelectorAll('.msg.user .achip').length") != 4:
            errs.append("sent message lost its attachment chips")
        # Voice: the one-time setup card, its progress, then recording.
        pg.evaluate("newChat()"); pg.wait_for_timeout(300)
        pg.evaluate("micClick()"); pg.wait_for_timeout(300)
        pg.screenshot(path=str(out / f"voice-setup-{theme}.png"))
        pg.evaluate("document.querySelector('#vcard .yes').click()"); pg.wait_for_timeout(100)
        pg.evaluate("fire('stt_progress', {stage: 'model', pct: 46, text: 'Downloading the Whisper base model… 65 of 142 MB'})"); pg.wait_for_timeout(300)
        pg.screenshot(path=str(out / f"voice-progress-{theme}.png"))
        pg.evaluate("closeVoice(); recUI(true)"); pg.wait_for_timeout(1200)
        pg.screenshot(path=str(out / f"voice-recording-{theme}.png"))
        pg.evaluate("recUI(false); insertText('Make the hero image smaller on phones and keep the headline on one line.')"); pg.wait_for_timeout(200)
        pg.screenshot(path=str(out / f"voice-text-{theme}.png"))
        # Modes: Plan (Ctrl+Tab) and Autopilot (Shift+Tab), from the keyboard.
        pg.evaluate("document.querySelector('#input').value=''; grow()")
        pg.focus("#input"); pg.keyboard.press("Control+Tab"); pg.wait_for_timeout(300)
        if pg.evaluate("MODES.work_mode") != "plan":
            errs.append("Ctrl+Tab didn't switch to Plan")
        pg.screenshot(path=str(out / f"mode-plan-{theme}.png"))
        pg.keyboard.press("Control+Tab"); pg.keyboard.press("Shift+Tab"); pg.wait_for_timeout(300)
        if pg.evaluate("MODES.work_mode + '/' + MODES.approval") != "build/autopilot":
            errs.append("Ctrl+Tab / Shift+Tab didn't give Build + Autopilot")
        pg.screenshot(path=str(out / f"mode-autopilot-{theme}.png"))
        pg.evaluate("""sendText('Upgrade the theme to the new Shopify CLI and make sure it still builds', []);
          fire('autopilot', {on: true, steps: 150, minutes: 45});
          fire('tool', {id: 'a1', name: 'run_shell', args: '{"command":"pnpm add -D @shopify/cli@latest"}'});
          fire('tool_done', {id: 'a1', result: 'exit 0'});
          fire('delta', 'The new CLI wants Node 20. Should I upgrade Node, or pin the old CLI?');
          fire('autoreply', 'The user is away');
          fire('delta', 'Pinned **@shopify/cli 3.66**, which still runs on your Node 18, and the theme builds. Assumption: upgrading Node is a bigger change than you asked for.');
          fire('done', {route: 'Google Gemini · gemini-3.8-flash', seconds: 48.0});""")
        pg.wait_for_timeout(400)
        pg.screenshot(path=str(out / f"autopilot-reply-{theme}.png"))
        if not pg.evaluate("document.querySelector('.apnote')"):
            errs.append("no Autopilot note in the chat")
        pg.evaluate("setApproval('auto'); setWorkMode('build')"); pg.wait_for_timeout(200)
        # v0.4: the orb (quick ask), at its real 400x560 size.
        pg.set_viewport_size({"width": 400, "height": 560})
        pg.evaluate("newChat().then(() => fire('orb', true))"); pg.wait_for_timeout(900)
        pg.screenshot(path=str(out / f"orb-{theme}.png"))
        pg.evaluate("""sendText('How much disk space is left?', []);
          fire('tool', {id: 'o1', name: 'system_info', args: '{}'});""")
        pg.wait_for_timeout(600)
        pg.screenshot(path=str(out / f"orb-working-{theme}.png"))
        pg.evaluate("""fire('tool_done', {id: 'o1', result: 'disk: 312 GB free of 1 TB'});
          fire('delta', '**312 GB free** of 1 TB. Your biggest folder is `~/code` (88 GB).');
          fire('done', {route: 'Google Gemini · gemini-3.8-flash', seconds: 3.4});""")
        pg.wait_for_timeout(400)
        pg.screenshot(path=str(out / f"orb-chat-{theme}.png"))
        steps_turn(pg, "orb-", None)
        pg.evaluate("""newChat().then(() => { sendText('How far is Blaze from 1.0?', []);
          fire('delta', window.__cardReply); fire('done', {route: 'Google Gemini · gemini-3.8-flash', seconds: 2.9}); })""")
        pg.wait_for_timeout(600)
        pg.screenshot(path=str(out / f"card-orb-{theme}.png"))
        # v0.4.7: the orb's compact running-agents indicator, while the user asks something else.
        pg.evaluate("""newChat().then(() => { sendText('Research the three best budget laptops for coding and compare them', []);
          fire('turn', {kind: 'user', conv: 'c9'});
          fire('tool', {id: 'd2', name: 'dispatch_agent', args: '{}'});
          fire('agent', {handle: 'laptops', conv: 'c9', task: 'Research the three best budget laptops for coding (under 700 USD) and compare them in a table.', status: 'running', now: 'Reading notebookcheck.net', n: 5, started: Date.now() - 65000, seconds: 65});
          fire('agent', {handle: 'price-check', conv: 'c9', task: 'Check Zambian prices for the shortlisted laptops.', status: 'running', now: 'Searching the web for "ThinkPad E14 price Lusaka"', n: 2, started: Date.now() - 20000, seconds: 20});
          fire('tool_done', {id: 'd2', result: 'started: agent "laptops"'});
          fire('delta', "On it. Two agents are researching; I'll report back with a comparison."); fire('done', {route: 'Google Gemini · gemini-3.8-flash', seconds: 1.2, handoff: true}); })""")
        pg.wait_for_timeout(600)
        pg.screenshot(path=str(out / f"orb-agents-{theme}.png"))
        if pg.evaluate("(document.querySelector('#orbbar .orbag') || {}).textContent") != "2 agents":
            errs.append("orb agents indicator missing")
        pg.evaluate("""['laptops', 'price-check'].forEach(h => fire('agent', {handle: h, status: 'cancelled', ended: Date.now()}))""")
        pg.evaluate("fire('orb', false)"); pg.set_viewport_size({"width": 1280, "height": 820}); pg.wait_for_timeout(300)
        # v0.4.8: the sun/moon theme switch in the top bar, flipped once and back.
        pg.evaluate("show('work')"); pg.wait_for_timeout(200)
        pg.evaluate("document.querySelector('#themeBtn').click()"); pg.wait_for_timeout(500)
        pg.screenshot(path=str(out / f"theme-flipped-{theme}.png"))
        flipped = pg.evaluate("document.documentElement.dataset.theme")
        if flipped == theme:
            errs.append("theme button didn't switch the theme")
        pg.evaluate("document.querySelector('#themeBtn').click()"); pg.wait_for_timeout(400)
        # v0.4.8: /update updates Blaze right in the chat (no Settings screen).
        pg.evaluate("newChat()"); pg.wait_for_timeout(300)
        pg.evaluate("""window.__upd = {current: 'v0.4.7', latest: 'v0.4.8', available: true, can_auto: true, method: 'Blaze downloads the setup and restarts.', page: ''};
          document.querySelector('#input').value = '/upd'; onType();""")
        pg.wait_for_timeout(300)
        pg.screenshot(path=str(out / f"update-command-{theme}.png"))
        pg.evaluate("pickMenu(0)"); pg.wait_for_timeout(900)
        pg.screenshot(path=str(out / f"update-chat-{theme}.png"))
        if "42%" not in pg.evaluate("(document.querySelector('.selfupd .work') || {}).textContent || ''"):
            errs.append("/update progress line missing")
        if pg.evaluate("view") != "work":
            errs.append("/update left the chat")
        pg.evaluate("newChat(); window.__upd = {current: 'v0.4.8', latest: 'v0.4.8', available: false}"); pg.wait_for_timeout(400)
        pg.evaluate("SelfUpdate.run()"); pg.wait_for_timeout(500)
        if "newest version" not in pg.evaluate("(document.querySelector('.selfupd .md') || {}).textContent || ''"):
            errs.append("/update up-to-date answer missing")
        pg.screenshot(path=str(out / f"update-latest-{theme}.png"))
        pg.evaluate("window.__upd = null")
        # v0.5: Memory graph. Overview, the best-linked memory selected, mid-replay, sorting into categories.
        pg.evaluate("show('memory')"); pg.wait_for_timeout(700)
        pg.evaluate("MemoryUI.settle()"); pg.wait_for_timeout(500)
        pg.screenshot(path=str(out / f"memory-{theme}.png"))
        st = pg.evaluate("MemoryUI.stats()")
        if not st or st["nodes"] < 60 or st["edges"] < 30 or st["cats"] < 6:
            errs.append(f"memory graph is missing data: {st}")
        pg.evaluate("MemoryUI.select(MemoryUI.live.nodes.filter(n => n.kind === 'memory').sort((a, b) => b.deg - a.deg)[0].i)"); pg.wait_for_timeout(600)
        pg.screenshot(path=str(out / f"memory-selected-{theme}.png"))
        pg.evaluate("MemoryUI.seek(0.45); MemoryUI.play(4)"); pg.wait_for_timeout(900)
        pg.screenshot(path=str(out / f"memory-replay-{theme}.png"))
        pg.evaluate("MemoryUI.seek(0.93)"); pg.wait_for_timeout(1500)
        pg.screenshot(path=str(out / f"memory-sorting-{theme}.png"))
        pg.evaluate("show('work')"); pg.wait_for_timeout(200)
        if pg.evaluate("!!(MemoryUI.live && !MemoryUI.live.dead)"):
            errs.append("memory graph kept running after leaving the screen")
        for v in ["settings", "doctor", "schedule", "jobs"]:
            pg.evaluate(f"show('{v}')"); pg.wait_for_timeout(400)
            pg.screenshot(path=str(out / f"{v}-{theme}.png"))
        for s in ["providers", "usage", "behaviour", "accounts"]:
            pg.evaluate(f"show('settings','{s}')"); pg.wait_for_timeout(500)
            pg.screenshot(path=str(out / f"settings-{s}-{theme}.png"))
        # v0.4.2: Settings › Behaviour › Personality (Default, then Custom with the textarea).
        pg.evaluate("show('settings','behaviour')"); pg.wait_for_timeout(500)
        pg.evaluate("[...document.querySelectorAll('.group')].find(g => /Personality/.test(g.textContent)).scrollIntoView({block: 'start'})"); pg.wait_for_timeout(200)
        pg.screenshot(path=str(out / f"personality-{theme}.png"))
        pg.evaluate("[...document.querySelectorAll('.seg button')].find(b => b.textContent === 'Custom').click()"); pg.wait_for_timeout(500)
        pg.evaluate("[...document.querySelectorAll('.group')].find(g => /Personality/.test(g.textContent)).scrollIntoView({block: 'start'})"); pg.wait_for_timeout(200)
        pg.screenshot(path=str(out / f"personality-custom-{theme}.png"))
        if not pg.evaluate("!!document.querySelector('textarea.pcustom')"):
            errs.append("custom personality textarea missing")
        # v0.4.x: Accounts (tabs All / Connections / Logins / API Keys) with real brand logos.
        pg.set_viewport_size({"width": 1280, "height": 1180})
        for t in ["all", "connections", "logins", "keys"]:
            pg.evaluate(f"show('accounts', '{t}')"); pg.wait_for_timeout(700)
            pg.screenshot(path=str(out / f"accounts-{t}-{theme}.png"))
        broken = pg.evaluate("[...document.querySelectorAll('.blogo img')].filter(i => !i.complete || !i.naturalWidth).map(i => i.src)")
        if broken:
            errs.append("brand logos failed to load: " + ", ".join(broken))
        pg.evaluate("document.querySelector('.aitem .arow').click()"); pg.wait_for_timeout(700)
        pg.screenshot(path=str(out / f"accounts-keys-open-{theme}.png"))
        for v, arg in [("connector", "google"), ("connector", "spotify"), ("mcp", "linear")]:
            pg.evaluate(f"show('{v}', '{arg}')"); pg.wait_for_timeout(500)
            pg.screenshot(path=str(out / f"{v}-{arg}-{theme}.png"))
        # v0.5.0: one-click connectors through blaze-auth, and Blaze accounts.
        pg.set_viewport_size({"width": 1280, "height": 900})
        pg.evaluate("show('connector', 'slack')"); pg.wait_for_timeout(500)
        pg.screenshot(path=str(out / f"connector-oneclick-{theme}.png"))
        if not pg.evaluate("!!document.querySelector('.oneclick .btn.accent')"):
            errs.append("one-click Connect box missing on the Slack page")
        if pg.evaluate("!!document.querySelector('.csetupwrap[open]')"):
            errs.append("manual setup should be folded away when one-click is available")
        pg.evaluate("document.querySelector('.oneclick .btn.accent').click()"); pg.wait_for_timeout(600)
        pg.screenshot(path=str(out / f"connector-oneclick-waiting-{theme}.png"))
        if not pg.evaluate("!!document.querySelector('.pend .waitline') && !document.querySelector('.pend details.paste')"):
            errs.append("one-click waiting box wrong (no wait line, or a paste box it doesn't need)")
        pg.evaluate("document.querySelector('.chead .acts .btn').click()"); pg.wait_for_timeout(400)
        pg.evaluate("show('accounts', 'all')"); pg.wait_for_timeout(700)
        pg.screenshot(path=str(out / f"accounts-oneclick-{theme}.png"))
        if not pg.evaluate("!!document.querySelector('.ucard.out')"):
            errs.append("signed-out account card missing on Accounts")
        pg.evaluate("show('signin')"); pg.wait_for_timeout(500)
        pg.screenshot(path=str(out / f"account-signin-{theme}.png"))
        if pg.evaluate("document.querySelectorAll('.signbox .obtn').length") != 2:
            errs.append("sign-in screen should offer Google and GitHub")
        pg.evaluate("document.querySelector('.signbox .sw').click()"); pg.wait_for_timeout(300)
        pg.screenshot(path=str(out / f"account-signup-{theme}.png"))
        pg.fill(".signform input[name=email]", "kapapaluckson75@gmail.com"); pg.fill(".signform input[name=password]", "correct-horse-battery")
        pg.evaluate("document.querySelector('.signform .go').click()"); pg.wait_for_timeout(900)
        pg.screenshot(path=str(out / f"account-signed-in-{theme}.png"))
        if pg.evaluate("(document.querySelector('.ucard .un') || {}).textContent") != "Lackson Kapapa":
            errs.append("Settings › Account doesn't show the signed-in user")
        pg.evaluate("show('accounts', 'all')"); pg.wait_for_timeout(700)
        pg.screenshot(path=str(out / f"accounts-signed-in-{theme}.png"))
        pg.evaluate("Object.assign(window.__acct, {signed_in: false, user: null}); show('settings', 'account')"); pg.wait_for_timeout(500)
        pg.evaluate("document.querySelector('.signbox .obtn').click()"); pg.wait_for_timeout(500)
        pg.screenshot(path=str(out / f"account-signin-waiting-{theme}.png"))
        pg.evaluate("window.__acct.pending = ''; document.querySelector('#toasts') && document.querySelector('#toasts').remove()")
        pg.set_viewport_size({"width": 1280, "height": 820})
        pg.evaluate("""show('work'); loadConv(window.__conv);
          fire('connector_reauth', {id: 'github', name: 'GitHub'});
          fire('confirm', {id: 'k1', title: 'Send this email from Gmail?', detail: 'To: gloria@example.com\\nSubject: Fees plan', always: true});
          fire('connector_suggest', {id: 'slack', name: 'Slack', action: 'connect', reason: 'Blaze needs Slack to read #general for this.'});
          fire('toast', {text: 'Google is now connected', kind: 'ok'});"""); pg.wait_for_timeout(400)
        pg.screenshot(path=str(out / f"connector-cards-{theme}.png"))
        # v0.4.x: first-run onboarding, every step (plus macOS permissions).
        pg.evaluate("document.querySelector('#toasts') && document.querySelector('#toasts').remove()")
        for i, name in enumerate(["welcome", "model", "apps", "perms", "tour", "done"]):
            pg.evaluate(f"show('setup', {i})"); pg.wait_for_timeout(900)
            pg.screenshot(path=str(out / f"onboard-{i + 1:02d}-{name}-{theme}.png"))
        pg.evaluate("""window.go.main.App.State().then(s => { s.__d = s.desktop; s.desktop = { ...s.desktop, os: 'darwin', needs_access: true, hotkey: 'alt+space', hotkey_label: 'Option+Space', hotkey_ok: false, hotkey_note: 'macOS needs Accessibility permission for the shortcut.' }; return show('setup', 3); })"""); pg.wait_for_timeout(900)
        pg.screenshot(path=str(out / f"onboard-04-perms-mac-{theme}.png"))
        pg.evaluate("window.go.main.App.State().then(s => { s.desktop = s.__d; Onboard.close(); show('work'); })"); pg.wait_for_timeout(300)
        # notify-vision: Settings › Notifications (notifications, suggestions, screen vision, recent).
        pg.evaluate("show('settings','notifications')"); pg.wait_for_timeout(600)
        pg.screenshot(path=str(out / f"settings-notifications-{theme}.png"))
        pg.evaluate("[...document.querySelectorAll('.group')].find(g => /Proactive suggestions/.test(g.textContent)).scrollIntoView({block: 'start'})"); pg.wait_for_timeout(200)
        pg.screenshot(path=str(out / f"settings-suggestions-{theme}.png"))
        pg.evaluate("[...document.querySelectorAll('.group')].find(g => /Screen vision/.test(g.textContent)).scrollIntoView({block: 'start'})"); pg.wait_for_timeout(200)
        pg.screenshot(path=str(out / f"settings-vision-{theme}.png"))
        if not pg.evaluate("/Proactive suggestions/.test(document.querySelector('#view').textContent)"):
            errs.append("Settings › Notifications did not render")
        # The privacy indicator while the screen is read, then a clicked suggestion in the chat.
        pg.evaluate("loadConv(window.__conv); show('work'); fire('screen', {on: true, how: 'text'})"); pg.wait_for_timeout(300)
        pg.screenshot(path=str(out / f"screen-indicator-{theme}.png"))
        if not pg.evaluate("!!document.querySelector('#screenind.on')"):
            errs.append("privacy indicator did not show")
        pg.evaluate("fire('screen', {on: false})"); pg.wait_for_timeout(1800)
        if pg.evaluate("!!document.querySelector('#screenind.on')"):
            errs.append("privacy indicator did not hide")
        pg.evaluate("""fire('suggest', {id: 'n3', kind: 'suggest', title: 'pnpm test fails in price.ts', body: 'Expected 19.99, got 19.989999. I can fix the rounding.', prompt: 'Fix the failing price test'})"""); pg.wait_for_timeout(300)
        pg.screenshot(path=str(out / f"suggest-{theme}.png"))
        # The indicator in the orb.
        pg.set_viewport_size({"width": 400, "height": 560})
        pg.evaluate("newChat().then(() => { fire('orb', true); fire('screen', {on: true, how: 'pixels'}); })"); pg.wait_for_timeout(700)
        pg.screenshot(path=str(out / f"orb-screen-{theme}.png"))
        pg.evaluate("fire('screen', {on: false}); fire('orb', false)"); pg.set_viewport_size({"width": 1280, "height": 820}); pg.wait_for_timeout(1700)
        if errs:
            print("JS errors:", errs); allerrs.extend(f"{theme}: {e}" for e in errs)
    # Windows runs frameless with its own title-bar buttons.
    pg = b.new_page(viewport={"width": 1280, "height": 820}, device_scale_factor=1)
    pg.add_init_script(f"window.__theme='light';window.__os='windows';window.__sample='{sample}';" + mock)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(url); pg.wait_for_timeout(600)
    pg.screenshot(path=str(out / "home-windows-light.png"))
    if errs:
        print("JS errors:", errs); allerrs.extend("windows: " + e for e in errs)
    # macOS: screen vision needs two permissions; Settings and Doctor offer to grant them.
    pg = b.new_page(viewport={"width": 1280, "height": 820}, device_scale_factor=1)
    pg.add_init_script(f"window.__theme='light';window.__os='darwin';window.__sample='{sample}';" + mock)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(url); pg.wait_for_timeout(600)
    pg.evaluate("show('settings','notifications')"); pg.wait_for_timeout(600)
    pg.evaluate("[...document.querySelectorAll('.group')].find(g => /Screen vision/.test(g.textContent)).scrollIntoView({block: 'start'})"); pg.wait_for_timeout(200)
    pg.screenshot(path=str(out / "settings-vision-mac-light.png"))
    pg.evaluate("show('doctor')"); pg.wait_for_timeout(600)
    pg.evaluate("document.querySelector('#view .page').scrollTop = 1e6"); pg.wait_for_timeout(200)
    pg.screenshot(path=str(out / "doctor-mac-light.png"))
    if pg.evaluate("document.querySelectorAll('#view .fixbtn').length") < 2:
        errs.append("Doctor has no Fix buttons for the macOS permissions")
    if errs:
        print("JS errors:", errs); allerrs.extend("macos: " + e for e in errs)
    b.close()
# Shots still get pushed when something broke; ERRORS.txt says what (the job then fails).
if allerrs:
    (out / "ERRORS.txt").write_text("\n".join(allerrs) + "\n"); sys.exit(1)
print("ok")
