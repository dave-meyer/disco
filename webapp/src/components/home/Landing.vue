<template>
  <div class="flex flex-col gap-4">
    <ButtonsCard
      class="mx-auto"
      :buttons="List.of(['get started', () => emit('click')])"
    >
      <template #title>
        <div class="flex justify-center">
          Build collaborative AI without sharing any data
        </div>
      </template>

      <ul style="list-style: &quot;✅&quot;" class="ml-5">
        <li class="pl-2">Data stays private and offline</li>
        <li class="pl-2">Code-free and installation-free</li>
        <li class="pl-2">
          Collaborative training via federated and decentralized learning
        </li>
      </ul>
    </ButtonsCard>
  </div>
</template>
<script lang="ts" setup>
import { List } from "immutable";

import ButtonsCard from "@/components/containers/ButtonsCard.vue";

const emit = defineEmits<{
  click: [];
}>();
</script>
