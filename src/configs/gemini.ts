/**
 * Gemini Embedding Configuration
 * 
 * This file contains configuration constants for Gemini embedding service.
 */

import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Gemini configuration
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const GEMINI_API_URL = process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com';
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'embedding-001';