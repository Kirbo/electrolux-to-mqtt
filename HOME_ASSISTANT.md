# Home Assistant

## MQTT topic info

The application will create a new topic under `{topic_prefix}appliances/info`, which by default will be `electrolux_appliances/info`.
The default payload will be e.g.:
```json
{
  "currentVersion": "v1.10.0",
  "status": "up-to-date",
  "releasedAt": "2026-02-21T11:07:02.068Z"
}
```

When an update is found, it will become e.g.:
```json
{
  "currentVersion": "v1.10.0",
  "status": "update-available",
  "latestVersion": "v1.10.2",
  "releasedAt": "2026-02-28T14:02:19.076Z",
  "description": "## 1.10.2 (2026-02-28)\n\n#### Bug Fixes\n\n* refresh token threshold decreased from 6 hours to 1 hour (7e1a1dd0)\n\n#### Documentation\n\n* update `HOME_ASSISTANT.md` examples (64b3c310)\n* update `README.md` and missing configs in examples (b884670a)\n\n"
}
```

## Automation examples

### When the MQTT topic status changes to "update-available"

Create a persistent notification and send a notification to all devices:
```yaml
alias: Electrolux MQTT - Notify update available
description: Listen to Electrolux MQTT topic and notify when an update is available
triggers:
  - topic: electrolux_appliances/info
    trigger: mqtt
conditions:
  - condition: template
    value_template: "{{ trigger.payload_json.status == 'update-available' }}"
actions:
  - action: persistent_notification.create
    data:
      title: Electrolux to MQTT
      notification_id: electrolux-to-mqtt
      message: |
        A new version {{ trigger.payload_json.latestVersion | default('unknown') }} has been released {{
          trigger.payload_json.releasedAt
          | as_datetime
          | as_local
          | relative_time
          if trigger.payload_json.releasedAt is defined
          else 'unknown'
        }} ago.
        You're running version {{ trigger.payload_json.currentVersion | default('unknown') }}.
        Read the release notes in https://gitlab.com/kirbo/electrolux-to-mqtt/-/releases/{{ trigger.payload_json.latestVersion }}
  - action: notify.notify
    data:
      title: Electrolux to MQTT
      message: |
        A new version {{ trigger.payload_json.latestVersion | default('unknown') }} has been released {{
          trigger.payload_json.releasedAt
          | as_datetime
          | as_local
          | relative_time
          if trigger.payload_json.releasedAt is defined
          else 'unknown'
        }} ago.
        You're running version {{ trigger.payload_json.currentVersion | default('unknown') }}.
        Read the release notes in https://gitlab.com/kirbo/electrolux-to-mqtt/-/releases/{{ trigger.payload_json.latestVersion }}
mode: single
```
