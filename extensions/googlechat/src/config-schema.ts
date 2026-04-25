import { buildChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";
import { GoogleChatConfigSchema } from "openclaw/plugin-sdk/googlechat-runtime-shared";

export const GoogleChatChannelConfigSchema = buildChannelConfigSchema(GoogleChatConfigSchema);
