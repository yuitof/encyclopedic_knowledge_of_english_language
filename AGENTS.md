# Instructions

## Linter

<!-- - verify that every note has timestamps before commit. If not, add them based on the filesystem's timestamps -->

## Compilation processes

<!-- - if markdowns reference to other markdown files that don't exist, create blank files during the building process so that links still work. If they are images, leave them as they are.

- Note that you need to add timestamps.

- During the building process, when you don't find explicit timestamps in markdown files, based on its commit timestamps. Do not override the existing timestamps. -->
<!-- - I have a question for you. Even if the timestamps are added to markdowns, the data in the code remain the same right? -->

## Graph view

<!-- - implement the graphy view page and put the link to it under "Explorer" on the left side bar. -->

## Design

<!--
- As for the notebooks on the landing page. Change the color of titles from blue to black. Also change the color of top bars from blue to grey or something. -->
<!-- - Notebooks on the landing page: make it 3x3 and the height of every row the same fixed value. -->

<!-- - Move the link "Graph view" on the left side bar above "Recently updated" -->
<!-- - On the graph view page, delete "Open a note with the keyboard" -->

<!-- - Add the full screen botton in the top right corner of the graph view. Expand the graph view to fill the entire window not the screen.
- Make the color of links to the most recent 10 pages and "show more" blue -->

<!-- - In the graph view, show names of pages only when the cursor is over it. And highlight the vertex that the cursor is over and the adjacent vertices by dimming out other vertices. -->

<!-- - on the left side bar, move the "show more" outside of "Recently updated"

- in "articles" page the text like "Sorted by" under the "Sort articles" pull down is redundant. Get rid of them.

- in "articles" page, calculate the number for "X items under this folder." in the body in advance during the building process while calculate the number for "Y of X articles." in the left side bar on client.
- in the landing page, calculate the number for "X notes in the collection." in the body in advance during the building process. -->

<!-- - OGP image -->
<!-- - do not show the preview when the cursor hovers "Show more" -->

<!-- ## the graph view

- In the graph view, add a fading animation when the cursor hovers a vertex and highlights vertices.
- In the graph view, do not change the transparency when dimming out vertices, instead change their color.
- In the graph view, make sure the circle comes to the center when going to the full window mode and going back to the window mode. -->

<!-- - Keep the thickness of the edges and the diameter of circles the same regardless of the zoom in and out in the canvas. -->

<!-- - Honestly keeping the diameters the same always feels off. When extremely zoomed in, make the diameters change according to how much you zoom in. In the intermediate and extreme zoom-out parts, make the diameters change change slower than the zooming speed.

- Also in the current implementation, users cannot zoom in to an extreme extent. Fix it. -->

<!-- - Use a more vivid blue like the one you used in OGP as the color of the highlighted vertex the cursor is over. Keep the color of the adjacent vertices as they are. -->

<!-- - Apply the same scaling rule to titles of pages
- Extreme zoom means more extreme then the current configurations.
- make the transition in the scaling speed smoother
- As you zoom in, when it gets to the extreme zoom-in, the other titles of pages starts to gradually show up as you go in.

- In the graph view, implement momentum zooming in and out making it feel luxurious.

- Set smaller the extent of zooming-in when names of pages start to gradually appear.
- As for names of pages, keep the size of names of pages changing slower than the zooming speed even when the extreme zooming-in. -->

<!-- - make the characters of pages' names smaller, place them under their vertices, and, when the cursor is over them, do not change the character size, instead get them to move downwards according to the extent of zoom (use the same rule when deciding the size of diameters. Note that the amount of movement itself isn't affected by the size of each diameter)
- when a cursor is over a vertex, make it not only change its color but also slightly bigger.

- can you make the overall size of diameters of circles smaller. It looks a little too dense because of their sizes. -->

<!-- - Also decide the size of names according to not only the extent of zooming but also the size of the diameter of its vertex. -->

<!-- - when the cursor is over a vertex and the other vertices are dimmed out, make edges except the highlighted ones be dimmed out as well. -->

<!-- - make more inertia the effect on the size of names by the size of the diameter of their vertex.

- I'm talking about the overall size of each name size. -->

<!-- - When you zoom to an extreme extent, the characters start to get blured. Fix it -->

- In the extreme zoom-in and zoom-out, change the zooming sensitivity to pinch gesture like the sigmoid function. I'm not sure if this works out the way I wanted. So make sure to commit in advance and be able to revert the change.
