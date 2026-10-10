# Security

Hearth-frontend is a single-owner web app under development, not a hosted service.

## Intended boundary

- Run on loopback. Listening on any other address requires an `OWNER_TOKEN` of 24+ characters; put HTTPS in
  front of a remote deployment.
- The browser reaches only this server. Hearth-Core and Hearth-backend credentials and addresses stay on the
  server.
- Claude Code runs in Hearth-Core under its own policy hook (no permission bypass, no web tools, no git
  remotes). The Files and Shell permissions shown in the app are enforced there, per turn.
- Page text, file contents, tool output and model output are untrusted data, never authorization.
- Page tools write only to Spaces the Dot was granted, with revision checks. `review_space_page` saves only
  after the owner approves.
- Never commit `.env` files or the `data/` databases.

## Reporting

Use the repository's private vulnerability reporting if available. Otherwise open an issue asking for a
private channel, without exploit details, credentials or personal data.
