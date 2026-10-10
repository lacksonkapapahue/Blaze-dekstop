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
        for v in ["settings", "doctor", "setup", "schedule", "jobs"]:
            pg.evaluate(f"show('{v}')"); pg.wait_for_timeout(400)
            pg.screenshot(path=str(out / f"{v}-{theme}.png"))
        for s in ["providers", "usage", "behaviour"]:
            pg.evaluate(f"show('settings','{s}')"); pg.wait_for_timeout(500)
            pg.screenshot(path=str(out / f"settings-{s}-{theme}.png"))
        if errs:
            print("JS errors:", errs); sys.exit(1)
    b.close()
print("ok")
