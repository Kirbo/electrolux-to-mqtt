import packageJson from '../package.json' with { type: 'json' }

const appVersion = packageJson.version

const init = (version: string = appVersion) => {
  console.info(`Starting Electrolux to MQTT version ${version}`)
}
export default init
