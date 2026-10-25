---
topic: project
title: "Astro Andy: Orbit Hop"
summary: "A one-tap iPhone arcade game, live on the App Store. Anderson built it solo with AI agents in SwiftUI and SpriteKit, with 445 automated tests, Game Center and iCloud sync."
updated: 2026-10-24
public: true
order: 4
status: "Live"
role: "He built it solo, with the assistance of AI. Together they designed, coded, implemented, tested, and published. He is also the support contact."
techLabel: "Stack"
tech:
  - "Swift"
  - "SwiftUI"
  - "SpriteKit"
  - "StoreKit"
  - "Game Center (GameKit)"
  - "iCloud sync"
  - "Google AdMob"
  - "XcodeGen"
  - "Claude Code"
cardTech:
  - "Swift"
  - "SwiftUI"
  - "SpriteKit"
  - "AI Tools"
links:
  repo: "https://github.com/avanegas95/I-Am-Rich"
  live: "https://avanegas.com/orbithop/"
  appStore: "https://apps.apple.com/us/app/astro-andy-orbit-hop/id6817951678"
featured: true
gallery:
  - file: "01-title.jpg"
    alt: "Title screen: \"One tap. Endless orbits.\" Astro Andy orbits a green planet under the game's logo, with a Tap to hop prompt."
  - file: "02-perfect.jpg"
    alt: "Gameplay: \"Tap on gold for a Perfect.\" Andy launches between planets with a score of 4 and a Perfect x4 combo badge."
  - file: "03-deep-space.jpg"
    alt: "Gameplay: \"Hop deeper into space.\" A jellyfish pilot circles a grey moon at a score of 26 with a Perfect x23 combo."
  - file: "04-trails.jpg"
    alt: "Gameplay: \"Blaze a trail in style.\" Andy flies between orange and green planets, leaving a sparkling trail."
  - file: "05-pilots.jpg"
    alt: "Hangar: \"Unlock 9 quirky pilots.\" The Retro Rocket pilot is equipped, above a grid of pilots, some still locked."
  - file: "06-rescue.jpg"
    alt: "Rescue screen: \"Rescue a stranded cat!\" Mr. Whiskers, a cat in a space suit, is rescued from planet 30."
  - file: "07-share.jpg"
    alt: "Share card: \"Beat your best. Brag a bit.\" A run summary of 47 planets hopped, 11 Perfects and a best combo of x7."
  - file: "08-supporter.jpg"
    alt: "Hangar: \"Suit up in Nebula style.\" Andy wears the Deep Space suit, with colorway choices below him."
video:
  file: "preview.mp4"
  captions: "preview.vtt"
  poster: "poster.jpg"
  description: "A 21-second App Store preview with music and game sounds. Andy hops from planet to planet and chains Perfect launches. The Hangar flicks through the pilots and suits. Captions read: One tap. Endless orbits. Tap on gold for a Perfect. Unlock 9 quirky pilots. Blaze a trail in style. Suit up in Nebula style. Tap to hop."
---

### What it does

Astro Andy: Orbit Hop is a one-tap arcade game for iPhone, free on the App Store. Andy orbits a planet, and a tap launches him toward the next one. Tap while the guide dots glow gold for a Perfect, which earns extra Stardust and builds a combo. Planets crumble if Andy lingers, and a missed orbit ends the run. Stardust unlocks nine pilots (including Mr. Whiskers, a cat stranded on a far planet), colorful suits and seven animated trails. No account or demo login is needed: anyone can download it and play, even offline.

### Highlights

- Shipped to the App Store solo, with AI agents helping on design, code, testing and release.
- 445 automated tests cover the game and three reusable Swift packages Anderson wrote for future one-tap games: a game core, an ads wrapper and a store wrapper.
- Privacy-friendly ads: the only ad is optional: a player can watch one to double a run's Stardust. There are no banners or pop-ups, ads are non-personalized and there's no cross-app tracking. A one-time Supporter Pack gives double Stardust without ads.
- There are no accounts and no personal data is sent to Anderson. Progress stays on the iPhone and, with iCloud on, syncs to the player's other devices.
- Scores and achievements go to Game Center for signed-in players.
- All art, music and sound effects were made for the game; only the two fonts are third party.

### How it was built

The app is a SwiftUI shell hosting a SpriteKit scene, about 20,000 lines of Swift, targeting iOS 17 and later. Purchases use StoreKit, scores use GameKit, and ads use Google AdMob with Google's consent tool. The Xcode project is generated from a config file with XcodeGen, and every tuning number lives in one file.

Anderson directed a Claude Code orchestrator that handed work to developer and designer agents. Each agent worked in its own git branch, and the orchestrator merged their work after review. Design choices went on a shared design board with a decisions page, where he approved each pick. Features he hadn't approved could only ship in internal test builds, behind a switch that's compiled out of App Store builds.

### QA angle

- Automated tests cover orbit math, planet generation, the Stardust economy, purchases, Game Center, art sizes, trail snapshots and performance budgets.
- A debug overlay (three-finger tap) shows capture radii, the launch window, frame rate and the run's seed. It exists only in debug and internal builds.
- Internal TestFlight builds ran with test ads and debug tools on; the App Store build uses a separate archive mode with both off.
- The App Store screenshots and the preview video are built by scripts. The video is cut on the beat, with sound effects synced to cues the game logs while recording.
- The game has a public support page and a privacy policy on this site. Players can report bugs at avanegas95@gmail.com, and replies usually arrive within a few days. The support page also covers restoring purchases and moving to a new phone.
