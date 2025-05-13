# Electrolux Comfort 600 to MQTT

## How to install

1. Sign up/sign in into [Electrolux for Developer](https://developer.electrolux.one/dashboard)
2. Create a new API Key and copy the value
3. 


## Running locally

```bash
docker compose -f docker-compose.local.yml down ; docker compose -f docker-compose.local.yml up --build
```


## Epilogue

Heavily inspired and thanks to [Dannyyy](https://github.com/dannyyy/electrolux_mqtt) for making the Electrolux to MQTT repository.
As I constantly had some issues with it, I decided to make my own implementation, based on [Public Electrolux API](https://developer.electrolux.one/documentation).