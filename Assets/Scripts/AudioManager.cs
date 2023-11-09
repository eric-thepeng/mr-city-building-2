using System;
using System.Collections;
using System.Collections.Generic;
using Unity.VisualScripting;
using UnityEngine;

public class AudioManager : MonoBehaviour
{
    // Static instance of the AudioManager which allows it to be accessed by any other script.
    public static AudioManager Instance { get; private set; }

    // Ensure that the instance is not destroyed between scenes (optional).
    private void Awake()
    {
        if (Instance == null)
        {
            Instance = this;
        }
    }
    
    public AudioSource[] audioSources;

    public void Start()
    {
        PlayClip(0, true);
    }

    /// <summary>
    /// index 0: BGM 1: Build 2: CancelBuild 3: Scoring 
    /// </summary>
    /// <param name="index"></param>
    /// <param name="loop"></param>
    public void PlayClip(int index, bool loop)
    {
        if (index < 0 || index >= audioSources.Length)
        {
            Debug.LogError("PlayClip index out of range: " + index);
            return;
        }

        // Set the loop property of the AudioSource.
        audioSources[index].loop = loop;

        // Play the audio clip.
        audioSources[index].Play();
    }
    
    public void PlayClipMultipleTimes(int index, int times, float delayBetweenPlays)
    {
        StartCoroutine(PlayClipMultipleTimesCoroutine(index, times, delayBetweenPlays));
    }

    private IEnumerator PlayClipMultipleTimesCoroutine(int index, int times, float delay)
    {
        // Loop 'times' times.
        for (int i = 0; i < times; i++)
        {
            // Play the sound.
            audioSources[index].Play();

            // Wait for the sound to finish playing, plus the specified delay.
            yield return new WaitForSeconds(audioSources[index].clip.length + delay);
        }
    }


}