// Overlay coordinator: Spotlight, Control Center, switcher, Mission Control.
import { wm } from './wm.js';
export { openSpotlight, closeSpotlight, toggleSpotlight, isSpotlightOpen } from './spotlight.js';
export { toggleControlCenter, closeControlCenter, isControlCenterOpen } from './controlcenter.js';
export { openSwitcher, cycleSwitcher, commitSwitcher, cancelSwitcher, isSwitcherOpen, quitSwitcherApp, switcherCurrent } from './switcher.js';

export function toggleMissionControl() {
  if (wm.isMission) wm.exitMission();
  else wm.enterMission();
}
export function closeOverlays() {
  if (wm.isMission) wm.exitMission();
}
