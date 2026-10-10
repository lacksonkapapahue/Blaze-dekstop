# Screenshots of the UI with a fake backend, pushed to the `shots` branch by CI.
import pathlib, sys
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).resolve().parent.parent
out = root / "shots"; out.mkdir(exist_ok=True)
mock = (root / "ci" / "mock.js").read_text()
url = (root / "frontend" / "dist" / "index.html").as_uri()
sample = (root / "ci" / "sample").as_uri()
with sync_playwright() as p:
    b = p.chromium.launch()
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
        pg.evaluate("""newChat().then(() => { sendText('How far is Blaze from 1.0?', []);
          fire('delta', window.__cardReply); fire('done', {route: 'Google Gemini · gemini-3.8-flash', seconds: 2.9}); })""")
        pg.wait_for_timeout(600)
        pg.screenshot(path=str(out / f"card-orb-{theme}.png"))
        pg.evaluate("fire('orb', false)"); pg.set_viewport_size({"width": 1280, "height": 820}); pg.wait_for_timeout(300)
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
        if errs:
            print("JS errors:", errs); sys.exit(1)
    # Windows runs frameless with its own title-bar buttons.
    pg = b.new_page(viewport={"width": 1280, "height": 820}, device_scale_factor=1)
    pg.add_init_script(f"window.__theme='light';window.__os='windows';window.__sample='{sample}';" + mock)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(url); pg.wait_for_timeout(600)
    pg.screenshot(path=str(out / "home-windows-light.png"))
    if errs:
        print("JS errors:", errs); sys.exit(1)
    b.close()
print("ok")
