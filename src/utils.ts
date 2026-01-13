import yaml from 'js-yaml'

import createLogger from './logger'
import { IMqtt } from './mqtt'
import { ApplianceInfo, ApplianceStub, SanitizedState } from './types'

const logger = createLogger('helpers')

export const initializeHelpers = (mqtt: IMqtt) => {
  const mapModes = {
    AUTO: 'auto',
    COOL: 'cool',
    DRY: 'dry',
    FANONLY: 'fan_only',
    HEAT: 'heat',
    OFF: 'off',
  }

  const mapFanModes = {
    AUTO: 'auto',
    HIGH: 'high',
    MIDDLE: 'medium',
    LOW: 'low',
    OFF: 'off',
  }

  const mapSwingModes = {
    ON: 'on',
    OFF: 'off',
  }

  const exampleConfig = (stub: ApplianceStub, info: ApplianceInfo, state: SanitizedState) => {
    // Dump the object as YAML, but remove the leading "- " from the first property
    const discoveryObj = autoDiscovery(stub, info, state)
    // Dump as YAML array, then fix the first line to be "- name: ''" instead of "-\n  name: ''"
    let discoveryYaml = yaml.dump([discoveryObj], { indent: 4, lineWidth: 200 })
    // Replace "-\n  name:" with "- name:" only at the start
    discoveryYaml = discoveryYaml.replace(/^- *\n +name:/m, '- name:')
    return `
climate:
  ${discoveryYaml}`
  }

  const autoDiscovery = (stub: ApplianceStub, info: ApplianceInfo, state?: SanitizedState) => {
    const { applianceId } = stub

    if (info.applianceInfo.deviceType !== 'PORTABLE_AIR_CONDITIONER') {
      logger.error(`Unsupported device type: ${info.applianceInfo.deviceType}, skipping auto-discovery..`)
    }

    return {
      name: '',
      object_id: `${info.applianceInfo.brand}_${info.applianceInfo.model}_${info.applianceInfo.serialNumber}`,
      uniq_id: `${info.applianceInfo.brand}_${info.applianceInfo.model}_${stub.applianceId}`,
      device: {
        identifiers: [stub.applianceId],
        manufacturer: info.applianceInfo.brand,
        model: info.applianceInfo.model,
        name: stub.applianceName,
      },

      availability_topic: `${mqtt.topicPrefix}/${applianceId}/state`,
      availability_template: '{{ value_json.connectionState }}',
      payload_available: 'connected',
      payload_not_available: 'disconnected',

      json_attributes_topic: `${mqtt.topicPrefix}/${applianceId}/state`,

      modes: Object.keys(info.capabilities.mode.values)
        .map((mode) => mapModes[mode as keyof typeof mapModes])
        .sort((a, b) => Object.values(mapModes).indexOf(a) - Object.values(mapModes).indexOf(b)),
      mode_state_topic: `${mqtt.topicPrefix}/${applianceId}/state`,
      mode_state_template: `{{ 'off' if value_json.applianceState == 'off' else ('fan_only' if value_json.mode == 'fan_only' else value_json.mode | lower) }}`,
      mode_command_topic: `${mqtt.topicPrefix}/${applianceId}/command`,
      mode_command_template: `{ "mode": "{{ 'FANONLY' if value == 'fan_only' else value | upper }}" }`,

      precision: 1,
      temperature_unit: 'C',
      initial: state?.targetTemperatureC ?? info.capabilities.targetTemperatureC.default,
      min_temp: info.capabilities.targetTemperatureC.min,
      max_temp: info.capabilities.targetTemperatureC.max,
      current_temperature_topic: `${mqtt.topicPrefix}/${applianceId}/state`,
      current_temperature_template: '{{ value_json.ambientTemperatureC }}',
      temperature_command_topic: `${mqtt.topicPrefix}/${applianceId}/command`,
      temperature_command_template: `{ "targetTemperatureC": {{ value }} }`,

      fan_modes: Object.keys(info.capabilities.fanSpeedSetting.values)
        .map((mode) => mapFanModes[mode as keyof typeof mapFanModes])
        .sort((a, b) => Object.values(mapFanModes).indexOf(a) - Object.values(mapFanModes).indexOf(b)),
      fan_mode_state_topic: `${mqtt.topicPrefix}/${applianceId}/state`,
      fan_mode_state_template: `{{ value_json.fanSpeedSetting if value_json.fanSpeedSetting != "middle" else "medium" }}`,
      fan_mode_command_topic: `${mqtt.topicPrefix}/${applianceId}/command`,
      fan_mode_command_template: `{ "fanSpeedSetting": "{{ 'middle' if value == 'medium' else value | upper }}" }`,

      swing_modes: Object.keys(info.capabilities.verticalSwing.values)
        .map((mode) => mapSwingModes[mode as keyof typeof mapSwingModes])
        .sort((a, b) => Object.values(mapSwingModes).indexOf(a) - Object.values(mapSwingModes).indexOf(b)),
      swing_mode_state_topic: `${mqtt.topicPrefix}/${applianceId}/state`,
      swing_mode_state_template: '{{ value_json.verticalSwing }}',
      swing_mode_command_topic: `${mqtt.topicPrefix}/${applianceId}/command`,
      swing_mode_command_template: `{ "verticalSwing": "{{ value | upper }}" }`,
    }
  }

  return {
    mapModes,
    mapFanModes,
    mapSwingModes,

    exampleConfig,
    autoDiscovery,
  }
}
