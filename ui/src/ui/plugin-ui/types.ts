export type PluginUiMount = {
  kind: "web_component";
  modulePath: string;
  tagName: string;
  exportName?: string;
  adapterId?: string;
  sessionAttribute?: string;
};

export type PluginUiDescriptor = {
  id: string;
  pluginId: string;
  extensionId: string;
  label: string;
  description?: string;
  icon?: string;
  group?: string;
  order?: number;
  mount: PluginUiMount;
};

export type PluginUiListResponse = {
  extensions: PluginUiDescriptor[];
};
