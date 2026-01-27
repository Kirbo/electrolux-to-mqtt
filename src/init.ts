import packageJson from '../package.json' with { type: 'json' }

const appVersion = packageJson.version

const init = () => {
  console.info(`Starting Electrolux to MQTT version: "${appVersion}"`)
}
export default init
