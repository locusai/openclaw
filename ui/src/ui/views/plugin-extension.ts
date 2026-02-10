import { html, nothing, type TemplateResult } from "lit";
import { html as staticHtml, unsafeStatic } from "lit/static-html.js";
import type { ControlUiExtensionDescriptor } from "../extensions/types.ts";

export type PluginExtensionViewProps = {
  extension: ControlUiExtensionDescriptor;
  ready: boolean;
  loadError: string | null;
  sessionKey: string;
  adapter?: unknown;
  onRetryLoad: () => Promise<void>;
};

function renderMountedExtension(
  extension: ControlUiExtensionDescriptor,
  sessionKey: string,
  adapter: unknown,
): TemplateResult {
  const tagName = unsafeStatic(extension.mount.tagName);
  const sessionAttribute = extension.mount.sessionAttribute?.trim();
  const attrName = sessionAttribute ? unsafeStatic(sessionAttribute) : null;
  if (attrName) {
    return staticHtml`
      <${tagName}
        class="plugin-extension__host"
        .adapter=${adapter}
        .sessionId=${sessionKey}
        session-id=${sessionKey}
        ${attrName}=${sessionKey}
      ></${tagName}>
    `;
  }
  return staticHtml`
    <${tagName}
      class="plugin-extension__host"
      .adapter=${adapter}
      .sessionId=${sessionKey}
      session-id=${sessionKey}
    ></${tagName}>
  `;
}

export function renderPluginExtension(props: PluginExtensionViewProps) {
  return html`
    <section class="card chat plugin-extension">
      ${
        props.ready
          ? renderMountedExtension(props.extension, props.sessionKey, props.adapter)
          : html`
              <div class="plugin-extension__status">
                <div class="muted">
                  ${
                    props.loadError
                      ? `Unable to load plugin extension "${props.extension.label}": ${props.loadError}`
                      : `Loading plugin extension "${props.extension.label}"...`
                  }
                </div>
                <button class="btn btn--sm" @click=${() => void props.onRetryLoad()}>
                  Retry
                </button>
              </div>
            `
      }
      ${props.ready && props.loadError ? html`<div class="muted">${props.loadError}</div>` : nothing}
    </section>
  `;
}
