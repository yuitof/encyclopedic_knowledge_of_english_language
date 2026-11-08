import fs from "node:fs";
import { slug } from "github-slugger";
import type { QuartzComponent } from "../quartz/components/types";
import { pathToRoot } from "../quartz/util/path";
// @ts-ignore: Quartz imports inline scripts as strings.
import navigationState from "./navigation-state.inline";

// Read only the frozen homepage, never discover or reapprove vault content.
const groups = [
  ...fs.readFileSync("content/index.md", "utf8").matchAll(/^### (.+)$/gm),
].map(([, label]) => ({ label, anchor: slug(label) }));

export const CatalogueNav: QuartzComponent = ({ fileData }) => (
  <nav class="catalogue-navigation" aria-label="Alphabetical catalogue">
    <h2>Alphabetical catalogue</h2>
    <ul>
      {groups.map(({ label, anchor }) => (
        <li>
          <a
            href={`${pathToRoot(fileData.slug!)}/#${encodeURIComponent(anchor)}`}
          >
            {label}
          </a>
        </li>
      ))}
    </ul>
  </nav>
);

CatalogueNav.afterDOMLoaded = navigationState;
