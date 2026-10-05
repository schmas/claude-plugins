# claude-plugins

Public Claude Code plugins and mods by schmas.

| Plugin | Scope | Contents |
|---|---|---|
| [`clean-view`](./plugins/clean-view) | Calm view for non-technical users (mod) | Hides tool calls, diffs and command output; shows one plain-English checklist with progress meters above the prompt. Three modes: `on` hides details, `both` shows details and the checklist, `off`. Switch with the band button or `/simple on\|both\|off` |

## Install

Add the marketplace once, then install the plugins you want.

```sh
/plugin marketplace add schmas/claude-plugins
/plugin install clean-view@schmas
/reload-plugins
```

## Repo layout

```
claude-plugins/
├── .claude-plugin/
│   └── marketplace.json        # Lists 1 plugin
├── plugins/
│   └── clean-view/
│       ├── .claude-plugin/plugin.json
│       ├── hooks/              # Function-hook mod + tests
│       └── types/              # Shared checklist state contract
└── README.md
```

## License

MIT. See [LICENSE](./LICENSE).
