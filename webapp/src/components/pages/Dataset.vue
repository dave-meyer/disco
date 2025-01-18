<template>
  <div class="space-y-8 mb-8">
    <h1 class="text-disco-cyan font-disco text-3xl text-center">The <DISCO/> team</h1>
    <IconCard>
      <template #title> Download datasets here </template>
      <div class="grid-container">
        <div
          v-for="(file, index) in files"
          :key="index"
          class="grid-item"
        >
          <a
            :href="getFileUrl(file)"
            :download="file"
            class="download-link"
          >
            Download {{ file }}
          </a>
        </div>
      </div>
    </IconCard>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import DISCO from "@/components/simple/DISCO.vue";
import IconCard from "@/components/containers/IconCard.vue";

const datasetNames = [
  "writer_f0000_14.zip",
  "writer_f0001_41.zip",
  "writer_f0002_01.zip",
  "writer_f0003_42.zip",
  "writer_f0004_09.zip",
  "writer_f0005_26.zip",
  "writer_f0006_12.zip",
  "writer_f0007_14.zip",
  "writer_f0008_45.zip",
  "writer_f0009_06.zip",
];

export default defineComponent({
  name: "FileDownloadGrid",
  components: {
    DISCO,
    IconCard,
  },
  data() {
    return {
      files: datasetNames,
    };
  },
  methods: {
    getFileUrl(fileName: string): string {
      return `${import.meta.env.BASE_URL}datasets/${fileName}`;
    },
  },
});
</script>

<style scoped>
.grid-container {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
  padding: 10px;
}
.grid-item {
  text-align: center;
}

.download-link {
  display: block;
  padding: 10px 15px;
  border: none;
  background-color: #007bff;
  color: white;
  border-radius: 5px;
  cursor: pointer;
  font-size: 14px;

  text-decoration: none;
  font-weight: bold;
}

.download-link:hover {
  background-color: #0056b3;
}
</style>
