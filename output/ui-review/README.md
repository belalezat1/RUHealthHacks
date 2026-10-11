# Local UI review

Coverage desk and Scenario lab are restored as primary navigation tabs. Scenario lab uses the real backend CSV validation and import endpoints. The desk refreshes backend state every five seconds; imported records can advance scenario time. No additional events or financial rates are generated.

Verified with Playwright at 1440×1000 and 390×844: both tabs navigate correctly, the selected tab is marked, CSV upload and sign out are visible, and neither page has horizontal overflow. The risk list expands from three priority entries to all 22 server-reported risks. Dark mode switches correctly. The coverage chart renders all three backend series without initial draw animations.

The supplied c2_new_events.csv was validated and imported unchanged in a disposable PostgreSQL database seeded with official challenge records: 8 accepted, 1 duplicate, 0 errors. Events changed from 1,163 to 1,171 and open consults from 18 to 19. There were no browser page errors during this capture. The current shared application run was not changed. Forecasts and staffing recommendations are modeled, not observed clinical improvements.

Build and frontend tests pass (3/3). The existing isolated end-to-end workflow checks passed (3/3), covering CSV replay/invalid headers/mobile, real offer approval and physician acceptance, and new official records importing without a restart with reference verification restored.

- after-desktop.png: current shared run, desktop desk.
- after-scenario-lab.png: desktop CSV input and steps.
- after-mobile-desk.png / after-mobile-lab.png: mobile layouts.
- after-dark-desk.png: dark mode.
- ../csv-import/c2_new_events/06-csv-operational-results.png: actual CSV before/after results.

Local preview: http://127.0.0.1:5180/app
No commit, push, or deployment performed.
