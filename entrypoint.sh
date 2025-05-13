#!/bin/bash
set -e

CONFIG_FILE="/app/config.yml"

if [ ! -f "${CONFIG_FILE}" ]; then
  MANDATORY_VARS=(
    MQTT_URL
    MQTT_USERNAME
    MQTT_PASSWORD
    ELECTROLUX_API_KEY
    ELECTROLUX_USERNAME
    ELECTROLUX_PASSWORD
    ELECTROLUX_COUNTRY_CODE
  )
  MANDATORY_VARS_SET=true
  MISSING_VARS=()

  for VAR in "${MANDATORY_VARS[@]}"; do
    if [ -z "${!VAR}" ]; then
      MISSING_VARS+=("$VAR")
      MANDATORY_VARS_SET=false
    fi
  done

  if [ "$MANDATORY_VARS_SET" = false ]; then
    echo "Please set all mandatory environment variables:"
    
    for VAR in "${MISSING_VARS[@]}"; do
      echo "  - $VAR"
    done

    exit 1
  fi

  echo "Config file not found. Creating ${CONFIG_FILE}..."
  cat <<EOF > "${CONFIG_FILE}"
mqtt:
  clientId: ${MQTT_CLIENT_ID:-electrolux-comfort600}
  url: ${MQTT_URL}
  username: ${MQTT_USERNAME}
  password: ${MQTT_PASSWORD}
  topicPrefix: ${MQTT_TOPIC_PREFIX:-electrolux_}
  retain: ${MQTT_RETAIN:-false}
  qos: ${MQTT_QOS:-2}

electrolux:
  apiKey: ${ELECTROLUX_API_KEY}
  username: ${ELECTROLUX_USERNAME}
  password: ${ELECTROLUX_PASSWORD}
  countryCode: ${ELECTROLUX_COUNTRY_CODE}
  refreshInterval: ${ELECTROLUX_REFRESH_INTERVAL:-30}

homeAssistant:
  autoDiscovery: ${HOME_ASSISTANT_AUTO_DISCOVERY:-true}
EOF
else
  echo "Config file already exists. Skipping creation."
fi

exec "$@"