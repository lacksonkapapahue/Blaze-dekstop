package main

// Lead mode (v0.9.2): Blaze is the lead and does no work itself. Every task goes to a
// specialist, which Blaze briefs, monitors, steers and reviews, so the chat is always
// free. Settings › Behaviour › "Blaze does tasks itself" turns it off.

// leadOnly reports whether this turn's lead may only run specialists. Design turns are
// exempt: point-to-edit and versions follow the files the lead itself changes.
func (a *App) leadOnly(design bool) bool { return !a.prefs.LeadWorks && !design }

// LeadWorks reports whether Blaze does tasks itself instead of handing them off.
func (a *App) LeadWorks() bool { return a.prefs.LeadWorks }

// SetLeadWorks turns lead mode off (true) or back on (false).
func (a *App) SetLeadWorks(on bool) bool {
	a.prefs.LeadWorks = on
	a.savePrefs()
	return on
}
