import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests/browser',use:{baseURL:'http://localhost:3000',viewport:{width:1440,height:1000}},workers:1,reporter:'list'});
