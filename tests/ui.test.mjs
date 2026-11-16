import test from "node:test";
import assert from "node:assert/strict";
import { createDemoState, GROUP_DEFS } from "../public/src/model.js";
import {
  confirmDraw,
  generateAdvancedPreview,
  generateGroupDraw,
  getMatchPlayers
} from "../public/src/engine.js";
import { renderApp, renderModal } from "../public/src/ui.js";

globalThis.window = {
  location: {
    pathname: "/admin/test-token",
    origin: "http://localhost:8787"
  }
};

function preparedState() {
  const state = createDemoState();
  for (const group of GROUP_DEFS) {
    if (group.level === "new") generateGroupDraw(state, group.key);
    else generateAdvancedPreview(state, group.key);
    confirmDraw(state, group.key);
  }
  return state;
}

test("全部页面和主要弹窗可以无异常渲染", () => {
  const state = preparedState();
  const root = {};
  for (const view of [
    "dashboard",
    "draw",
    "groups",
    "bracket",
    "schedule",
    "teams",
    "players",
    "settings"
  ]) {
    for (const role of ["admin", "viewer"]) {
      assert.doesNotThrow(() =>
        renderApp({
          root,
          state,
          role,
          view,
          selectedGroup: "new_men",
          network: "online",
          saving: false,
          adminPath: "/admin/test-token"
        })
      );
      assert.match(root.innerHTML, /MiHoo/);
      assert.doesNotMatch(root.innerHTML, />undefined</);
    }
  }

  const match = state.matches.find(
    (entry) => entry.group === "advanced_men" && entry.phase === "qualifier"
  );
  const player = getMatchPlayers(state, match)[0];
  const modals = [
    { type: "winner", data: { matchId: match.id, playerId: player.id } },
    { type: "player", data: { groupKey: "new_men" } },
    { type: "match-schedule", data: { matchId: match.id } },
    { type: "points", data: {} },
    { type: "units", data: {} },
    { type: "event", data: {} },
    { type: "schedule-settings", data: {} },
    {
      type: "import-preview",
      data: {
        rows: [
          {
            name: "测试选手",
            department: "计算机系",
            group: "新手男子",
            canonicalGroup: "new_men",
            unit: state.units[0],
            error: ""
          }
        ],
        errors: []
      }
    },
    {
      type: "generic",
      data: { title: "测试确认", message: "测试消息", confirmLabel: "确认" }
    }
  ];
  for (const modal of modals) {
    const html = renderModal(modal, state, "admin");
    assert.match(html, /modal/);
    assert.doesNotMatch(html, />undefined</);
  }
});
