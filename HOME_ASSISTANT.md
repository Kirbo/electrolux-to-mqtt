# Home Assistant

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
  - data:
      title: Electrolux to MQTT
      notification_id: electrolux-to-mqtt
      message: >-
        A new version {{ trigger.payload_json.latestVersion | default('unknown')
        }} has been released {{
          trigger.payload_json.latestReleasedAt
          | as_datetime
          | as_local
          | relative_time
          if trigger.payload_json.latestReleasedAt is defined
          else 'unknown'
        }}. You're running version {{ trigger.payload_json.currentVersion |
        default('unknown') }}.
    action: persistent_notification.create
  - action: notify.notify
    data:
      title: Electrolux to MQTT
      message: >-
        A new version {{ trigger.payload_json.latestVersion | default('unknown')
        }} has been released {{
          trigger.payload_json.latestReleasedAt
          | as_datetime
          | as_local
          | relative_time
          if trigger.payload_json.latestReleasedAt is defined
          else 'unknown'
        }}. You're running version {{ trigger.payload_json.currentVersion |
        default('unknown') }}.
mode: single
```