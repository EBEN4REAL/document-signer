
# 📄 PDF Signer — Drag-and-Drop Signature Tool (Vue 3)

A browser-based tool built with **Vue 3**, **pdf-lib**, **PDF.js**, and **Interact.js** that allows users to **upload PDFs**, drag-and-drop **signature or initials fields**, and generate a newly **signed PDF document — no backend required**.


### Snapshot

<img width="1280" height="767" alt="image" src="https://github.com/user-attachments/assets/ffdadb25-1095-4eb0-a666-6f3776f4aca7" />

<img width="1280" height="769" alt="image" src="https://github.com/user-attachments/assets/0e3dda25-5acb-463d-a290-3dd07f35abc8" />


DEMO: https://docs-signer.netlify.app/


---

### ✨ Key Features

* Upload one or multiple **PDF files** (or images)
* Drag-and-drop **Signature** and **Initials** fields onto pages
* **Drag, resize, delete, or replace** fields during layout phase
* **Draw or upload signature images**, or type initials in the fill phase
* Saves configuration to **IndexedDB** for session persistence
* Produces a **flattened, signed PDF** using `pdf-lib`

---

### 🧠 How it Works

1. **Layout Phase** → Upload PDFs and visually place fields
2. **Save Config** → Locks the layout for filling
3. **Fill Phase** → Add signatures/initials to fields
4. **Complete** → Generates and downloads a signed PDF
