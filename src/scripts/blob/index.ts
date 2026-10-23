import { streamChat } from "./chat-client";
import { attachConversation } from "./conversation";
import { BlobAgent, defineBlobAgent } from "./element";

BlobAgent.attach = (el) => attachConversation(el, { stream: streamChat });
defineBlobAgent();
