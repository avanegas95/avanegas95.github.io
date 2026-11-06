import { mood } from "./moods.DDDD4444.js";
class BlobAgent extends HTMLElement {
  connectedCallback() {
    this.textContent = mood;
  }
}
customElements.define("blob-agent", BlobAgent);
