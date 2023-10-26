using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class SupportBeam : MonoBehaviour
{
    [SerializeField] private Transform beamBody;
    private float distance = 0;
    
    public float CalculateSupportBeam()
    {
        distance = GetDistanceToGround();
        AdjustSupportingBeam(distance);
        return distance;
    }

    public void ResetBeam()
    {
        distance = 0;
        AdjustSupportingBeam(distance);
    }
    
    public float GetDistanceToGround()
    {
        // Cast a ray from the targetTransform's position downward
        Ray ray = new Ray(transform.position, Vector3.down);

        // Create a RaycastHit variable to store information about the hit
        RaycastHit hit;

        // Set the maximum distance for the raycast (you can adjust this as needed)
        float maxDistance = 2;

        // Perform the raycast
        if (Physics.Raycast(ray, out hit, maxDistance))
        {
            // Calculate the distance to the ground collider
            float distanceToGround = hit.distance;
            return distanceToGround;
        }

        // If the raycast doesn't hit anything, return a large value to indicate no ground found.
        return Mathf.Infinity;
    }

    public void AdjustSupportingBeam(float height)
    {
        beamBody.transform.localScale =
            new Vector3(beamBody.transform.localScale.x, height / 2, beamBody.transform.localScale.z);
        beamBody.transform.localPosition =
            new Vector3(beamBody.transform.localPosition.x, -height / 2, beamBody.transform.localPosition.z);
    }
}
