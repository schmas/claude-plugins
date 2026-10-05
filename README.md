# claude-plugins

Public Claude Code plugins and mods by schmas.

| Plugin | Scope | Contents |
|---|---|---|
| [`clean-view`](./plugins/clean-view) | Calm view for non-technical users (mod) | Hides tool calls, diffs and command output; shows one plain-English checklist with progress meters above the prompt. Three modes: `on` hides details, `both` shows details and the checklist, `off`. Switch with the band button or `/simple on\|both\|off`. With Toolbox installed, the switch is a row in the Toolbox panel |
| [`toolbox`](./plugins/toolbox) | Model and effort switcher (mod) | **◆ Toolbox** button opens a panel. Both sit last above the prompt; a SETTINGS row moves the button under the prompt. One click sets the session model or effort. Other mods add rows to it through `$.toolbox`. Toggle with the button or `/toolbox` |

## Install

Add the marketplace once, then install the plugins you want.

```sh
/plugin marketplace add schmas/claude-plugins
/plugin install clean-view@schmas
/plugin install toolbox@schmas
/reload-plugins
```

## Repo layout

```
claude-plugins/
├── .claude-plugin/
│   └── marketplace.json        # Lists 2 plugins
├── plugins/
│   ├── clean-view/
│   │   ├── .claude-plugin/plugin.json
│   │   ├── hooks/              # Function-hook mod + tests
│   │   └── types/              # Shared checklist state contract
│   └── toolbox/
│       ├── .claude-plugin/plugin.json
│       ├── hooks/              # Function-hook mod + tests
│       └── types/              # $.toolbox add-on API + state contract
└── README.md
```

## License

MIT. See [LICENSE](./LICENSE).
