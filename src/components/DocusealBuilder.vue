<template>
    <DocusealBuilder
      :token="'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2VtYWlsIjoiaWdiaW5vYmFlYmVuZXplckBnbWFpbC5jb20iLCJkb2N1bWVudF91cmxzIjpbImh0dHBzOi8vd3d3LnczLm9yZy9XQUkvRVIvdGVzdHMveGh0bWwvdGVzdGZpbGVzL3Jlc291cmNlcy9wZGYvZHVtbXkucGRmIl0sIm5hbWUiOiJBQ1AgQ29uc2VudCBGb3JtIFRlbXBsYXRlIiwiZm9sZGVyX25hbWUiOiJISCBDb25zZW50IFRlbXBsYXRlcyIsImlhdCI6MTc1MDY4MzI0NX0.RYayQ9A1Eiv9s4azb1kbBEtKyCbaO4IWIRDz8kCObKY'"/>
  </template>
  
  <script lang="ts">
  import { DocusealBuilder } from '@docuseal/vue'
  
  export default {
    name: 'App',
    components: {
      DocusealBuilder
    }
  }
  </script>
  