# Use a local Ollama vision service

In **Settings → Vision**, choose **OpenAI Chat Completions**, set the base URL to `http://127.0.0.1:11434/v1`, and enter the exact name of a locally installed vision-capable model. Under advanced settings, use credential name `OLLAMA_LOCAL_KEY`; enter `ollama` as the API-key value, then save and apply. The plugin requires a nonempty credential; local Ollama ignores this placeholder, as described in its [OpenAI compatibility guide](https://docs.ollama.com/api/openai-compatibility).

Test the vision model, then leave and reopen Settings to verify the saved values. If the built-in service returns HTTP 429, wait for its Retry-After interval or select your own endpoint here.

For a Profile-patch fallback, override the existing bundle row instead of inserting a second plugin:

```yaml
- id: vision-toolkit
  config:
    provider:
      protocol: openai
      baseUrl: http://127.0.0.1:11434/v1
      model: YOUR_INSTALLED_VISION_MODEL
      credential: OLLAMA_LOCAL_KEY
```

Replace `YOUR_INSTALLED_VISION_MODEL` with the installed model name. `credential` is a reference name, not the key value. On DSH 0.2.2-rc.1, store `OLLAMA_LOCAL_KEY=ollama` in `$DSH_HOME/.env` (normally `~/.dsh/.env`), or save that reference through Settings. The host's managed credential store takes precedence over environment files; do not reuse `ANIONEX_FREE_VISION` for a custom endpoint. Restart the Profile after editing its patch and open a new session. For Desktop, use its own Profile/settings controls.

Desktop settings saves rejected with “The request must originate from this DSH Web application” are fixed in plugin 0.1.50. [Python runtime setup](python-runtime.md) is independent of the model endpoint.
