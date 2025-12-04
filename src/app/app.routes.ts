import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./eec11/eec11.component').then(m => m.Eec11Component)
  }
];
