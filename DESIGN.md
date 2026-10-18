# Club House sports UI/UX

## Current direction
Red, golden yellow, black and white. Reference-inspired sports scoreboard on the opening Home screen. Barlow Condensed Bold for scores, headings and team names; Poppins for readable controls and body text. Original club crests use team initials.

## Home screen
Featured real match score appears before clubs. Live fixtures take priority, followed by the latest completed result, then scheduled fixtures. Sport and status filters use the backend fixture data. Scoreboards open their own match detail; Home refreshes bootstrap data every 10 seconds while online. Saved scores are labelled offline. No match clocks or periods are invented.

## Responsive design
Phone uses a single main scoreboard and stacked match cards with bottom navigation. Desktop adds a stadium photo and adjacent match cards. Existing club hub, photo gallery, calendar, standings, store, and offline workflows remain accessible. Dark and light themes are supported.

## Local preview
http://127.0.0.1:4186/ — run instructions in mobile/web/README.md. Local backend required on port 8080. Sources and licensed image/font assets are packaged in the separate UI-UX-Backups folder. No redesign commit or push was made.

## Checks for this revision
TypeScript and diff whitespace checks passed. The web preview was inspected at 360px phone and 1280px desktop widths; match navigation and the Upcoming filter were exercised against real local fixtures. Native device rendering and a full workflow test suite were not run for this revision.
