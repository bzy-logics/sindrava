---
layout: home

hero:
  name: sindrava
  text: Operator UI for MotionCore
  tagline: Watch, jog, home and stop your robot from the browser — with a 3D view, live diagnostics and firmware builds. Every value on screen comes from engine telemetry; the UI never invents robot state.
  image:
    src: /logo.svg
    alt: sindrava
  actions:
    - theme: brand
      text: Getting started
      link: /guide/getting-started
    - theme: alt
      text: Screens
      link: /guide/screens
    - theme: alt
      text: Safety behaviour
      link: /guide/safety

features:
  - title: E-STOP on every screen
    details: Never disabled, and only reported as confirmed once the engine says emergency_stopped. If confirmation doesn't come within 2 s, the UI tells you to use the hardware E-stop.
    link: /guide/safety
  - title: Live or not at all
    details: Motion controls are disabled unless telemetry is live and fresh. The header always shows live, reconnecting, disconnected, stale or faulted.
    link: /guide/safety#connection-status
  - title: Role-aware
    details: Viewers watch and stop, operators move and build firmware, admins flash. Controls you can't use are disabled with an explanation; the server enforces the same rules.
    link: /guide/authentication
  - title: A replaceable client
    details: It talks only to ratavyr's public REST and WebSocket API and holds no robot logic. Scripts, HMI panels or another frontend can use the same API.
    link: /development/api-client
---
