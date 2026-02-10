export type ControlUiExtensionMount = {
  kind: "web_component";
  modulePath: string;
  tagName: string;
  exportName?: string;
  adapterId?: string;
  sessionAttribute?: string;
};

export type ControlUiExtensionDescriptor = {
  id: string;
  pluginId: string;
  extensionId: string;
  label: string;
  description?: string;
  icon?: string;
  group?: string;
  order?: number;
  mount: ControlUiExtensionMount;
};

export type ControlUiExtensionsListResponse = {
  extensions: ControlUiExtensionDescriptor[];
};
