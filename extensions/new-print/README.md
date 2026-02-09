# New Print Demo Plugin

Minimal plugin demonstrating command-hook interception for `/new`.

When enabled, this plugin handles:

- `/new --print hello world`
- `/new --print=\"hello world\"`

and replies with the provided text while stopping further `/new` processing for that turn.
