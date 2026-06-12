import { createApp } from "vue";
import TierPage from "./TierPage.vue";
import "./styles/styles.css";

createApp(TierPage, { pageKind: "battleFestival" }).mount("#app");
