import { createRouter, createWebHistory } from 'vue-router'
import PdfSignerPage from '../views/PdfSignerPage.vue';
import DocsSigner from '../views/DocsSigner.vue';

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/docs-signer',
      name: 'DocsSigner',
      component: DocsSigner,
    },
    {
      path: '/',
      name: 'PdfSigner',
      component: PdfSignerPage,
    },
  ],
})

export default router
